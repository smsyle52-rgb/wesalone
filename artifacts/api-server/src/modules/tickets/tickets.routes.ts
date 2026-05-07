import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, ilike, sql } from "drizzle-orm";
import {
  db, ticketsTable, contactsTable, conversationsTable,
  workspaceMembershipsTable, usersTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const VALID_STATUSES = ["new", "open", "in_progress", "waiting_on_customer", "resolved", "closed"] as const;
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type TicketStatus = (typeof VALID_STATUSES)[number];

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["open"],
  open: ["in_progress", "resolved"],
  in_progress: ["waiting_on_customer", "resolved", "open"],
  waiting_on_customer: ["in_progress", "resolved"],
  resolved: ["closed", "open"],
  closed: [],
};

function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const createSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب"),
  description: z.string().optional(),
  priority: z.enum(VALID_PRIORITIES).default("normal"),
  category: z.string().optional(),
  contactId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
  assignedMembershipId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  category: z.string().optional(),
  assignedMembershipId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
});

router.get("/", requirePermission("tickets:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = req.query.status as string | undefined;
  const priority = req.query.priority as string | undefined;
  const search = req.query.search as string | undefined;
  const contactId = req.query.contactId as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(ticketsTable.workspaceId, activeWorkspaceId)];
  if (status) conditions.push(eq(ticketsTable.status, status));
  if (priority) conditions.push(eq(ticketsTable.priority, priority));
  if (contactId) conditions.push(eq(ticketsTable.contactId, contactId));
  if (search) conditions.push(ilike(ticketsTable.title, `%${search}%`));

  const [tickets, [{ total }], countRows] = await Promise.all([
    db.select({
      id: ticketsTable.id,
      number: ticketsTable.number,
      title: ticketsTable.title,
      status: ticketsTable.status,
      priority: ticketsTable.priority,
      category: ticketsTable.category,
      dueAt: ticketsTable.dueAt,
      resolvedAt: ticketsTable.resolvedAt,
      createdAt: ticketsTable.createdAt,
      updatedAt: ticketsTable.updatedAt,
      contactId: ticketsTable.contactId,
      contactName: contactsTable.name,
      conversationId: ticketsTable.conversationId,
      assignedMembershipId: ticketsTable.assignedMembershipId,
    })
      .from(ticketsTable)
      .leftJoin(contactsTable, eq(ticketsTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(ticketsTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(ticketsTable).where(and(...conditions)),
    db.select({ status: ticketsTable.status, cnt: count() })
      .from(ticketsTable)
      .where(eq(ticketsTable.workspaceId, activeWorkspaceId))
      .groupBy(ticketsTable.status),
  ]);

  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.status] = Number(r.cnt);

  res.json({ tickets, total: Number(total), counts });
});

router.post("/", requirePermission("tickets:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const { activeWorkspaceId, userId } = req.sessionUser;

  if (parsed.data.contactId) {
    const [c] = await db.select({ id: contactsTable.id }).from(contactsTable)
      .where(and(eq(contactsTable.id, parsed.data.contactId), eq(contactsTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!c) { res.status(404).json({ error: "العميل غير موجود أو لا ينتمي لهذا الحساب" }); return; }
  }

  if (parsed.data.conversationId) {
    const [c] = await db.select({ id: conversationsTable.id }).from(conversationsTable)
      .where(and(eq(conversationsTable.id, parsed.data.conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!c) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا الحساب" }); return; }
  }

  const [{ maxNum }] = await db.select({ maxNum: sql<number>`COALESCE(MAX(${ticketsTable.number}), 0)` })
    .from(ticketsTable).where(eq(ticketsTable.workspaceId, activeWorkspaceId));

  const [ticket] = await db.insert(ticketsTable).values({
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    category: parsed.data.category,
    contactId: parsed.data.contactId,
    conversationId: parsed.data.conversationId,
    sourceMessageId: parsed.data.sourceMessageId,
    assignedMembershipId: parsed.data.assignedMembershipId,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
    number: (maxNum ?? 0) + 1,
    workspaceId: activeWorkspaceId,
    createdBy: userId,
    status: "new",
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create",
    severity: "info",
    entityType: "ticket",
    entityId: ticket.id,
    entityLabel: ticket.title,
    newData: { title: ticket.title, priority: ticket.priority, status: ticket.status, contactId: ticket.contactId },
  });

  if (ticket.contactId) {
    await addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: ticket.contactId,
      eventType: "ticket_created",
      title: `تم إنشاء تذكرة: ${ticket.title}`,
      entityType: "ticket",
      entityId: ticket.id,
      createdBy: userId,
    });
  }

  res.status(201).json({ ticket });
});

router.get("/:id", requirePermission("tickets:read"), async (req: AuthenticatedRequest, res: Response) => {
  const [ticket] = await db.select({
    id: ticketsTable.id,
    number: ticketsTable.number,
    title: ticketsTable.title,
    status: ticketsTable.status,
    priority: ticketsTable.priority,
    description: ticketsTable.description,
    category: ticketsTable.category,
    dueAt: ticketsTable.dueAt,
    resolvedAt: ticketsTable.resolvedAt,
    closedAt: ticketsTable.closedAt,
    contactId: ticketsTable.contactId,
    conversationId: ticketsTable.conversationId,
    sourceMessageId: ticketsTable.sourceMessageId,
    assignedMembershipId: ticketsTable.assignedMembershipId,
    createdBy: ticketsTable.createdBy,
    createdAt: ticketsTable.createdAt,
    updatedAt: ticketsTable.updatedAt,
    contactName: contactsTable.name,
  })
    .from(ticketsTable)
    .leftJoin(contactsTable, eq(ticketsTable.contactId, contactsTable.id))
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);

  if (!ticket) { res.status(404).json({ error: "التذكرة غير موجودة" }); return; }
  res.json({ ticket });
});

router.patch("/:id", requirePermission("tickets:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "التذكرة غير موجودة" }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
  if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
  if ("assignedMembershipId" in parsed.data) updateData.assignedMembershipId = parsed.data.assignedMembershipId;
  if ("dueAt" in parsed.data) updateData.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt as string) : null;

  const [ticket] = await db.update(ticketsTable)
    .set(updateData)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "ticket",
    entityId: ticket.id,
    entityLabel: ticket.title,
    oldData: { title: existing.title, priority: existing.priority },
    newData: parsed.data as Record<string, unknown>,
  });

  if (ticket.contactId) {
    await addContactTimeline({
      workspaceId: req.sessionUser.activeWorkspaceId,
      contactId: ticket.contactId,
      eventType: "ticket_updated",
      title: `تم تحديث التذكرة: ${ticket.title}`,
      entityType: "ticket",
      entityId: ticket.id,
      createdBy: req.sessionUser.userId,
    });
  }

  res.json({ ticket });
});

router.patch("/:id/status", requirePermission("tickets:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "التذكرة غير موجودة" }); return; }

  const from = existing.status as TicketStatus;
  const to = parsed.data.status;

  if (!canTransition(from, to)) {
    res.status(422).json({
      error: `لا يمكن تغيير حالة التذكرة من "${from}" إلى "${to}"`,
      code: "INVALID_TRANSITION",
    });
    return;
  }

  const setData: Record<string, unknown> = { status: to, updatedAt: new Date() };
  if (to === "resolved") setData.resolvedAt = new Date();
  if (to === "closed") setData.closedAt = new Date();

  const [ticket] = await db.update(ticketsTable)
    .set(setData)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "ticket",
    entityId: ticket.id,
    entityLabel: ticket.title,
    oldData: { status: from },
    newData: { status: to },
  });

  if (ticket.contactId) {
    await addContactTimeline({
      workspaceId: req.sessionUser.activeWorkspaceId,
      contactId: ticket.contactId,
      eventType: "ticket_status_changed",
      title: `تذكرة "${ticket.title}": تغيّرت الحالة إلى ${to}`,
      entityType: "ticket",
      entityId: ticket.id,
      createdBy: req.sessionUser.userId,
      metadata: { from, to },
    });
  }

  res.json({ ticket });
});

router.patch("/:id/assign", requirePermission("tickets:assign"), async (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({ membershipId: z.string().uuid().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "التذكرة غير موجودة" }); return; }

  let assigneeName: string | null = null;
  if (parsed.data.membershipId) {
    const [m] = await db.select({ id: workspaceMembershipsTable.id, name: usersTable.name })
      .from(workspaceMembershipsTable)
      .leftJoin(usersTable, eq(workspaceMembershipsTable.userId, usersTable.id))
      .where(and(eq(workspaceMembershipsTable.id, parsed.data.membershipId), eq(workspaceMembershipsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
      .limit(1);
    if (!m) { res.status(404).json({ error: "العضو غير موجود" }); return; }
    assigneeName = m.name ?? null;
  }

  const [ticket] = await db.update(ticketsTable)
    .set({ assignedMembershipId: parsed.data.membershipId, updatedAt: new Date() })
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "ticket",
    entityId: ticket.id,
    entityLabel: ticket.title,
    newData: { assignedMembershipId: parsed.data.membershipId, assigneeName },
  });

  res.json({ ticket, assigneeName });
});

router.delete("/:id", requirePermission("tickets:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const [existing] = await db.select({ id: ticketsTable.id, title: ticketsTable.title, contactId: ticketsTable.contactId })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "التذكرة غير موجودة" }); return; }

  await db.delete(ticketsTable)
    .where(and(eq(ticketsTable.id, req.params.id as string), eq(ticketsTable.workspaceId, req.sessionUser.activeWorkspaceId)));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete",
    severity: "warning",
    entityType: "ticket",
    entityId: existing.id,
    entityLabel: existing.title,
  });

  res.json({ ok: true });
});

export default router;
