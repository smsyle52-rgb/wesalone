import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, ilike, lte, gte } from "drizzle-orm";
import {
  db, tasksTable, contactsTable, conversationsTable,
  workspaceMembershipsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const VALID_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type TaskStatus = (typeof VALID_STATUSES)[number];

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "done", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const createSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب"),
  description: z.string().optional(),
  priority: z.enum(VALID_PRIORITIES).default("normal"),
  dueAt: z.string().datetime().optional(),
  contactId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
  assignedMembershipId: z.string().uuid().optional(),
  relatedType: z.string().optional(),
  relatedId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedMembershipId: z.string().uuid().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
});

router.get("/", requirePermission("tasks:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const contactId = req.query.contactId as string | undefined;
  const dueToday = req.query.dueToday === "true";
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(tasksTable.workspaceId, activeWorkspaceId)];
  if (status) conditions.push(eq(tasksTable.status, status));
  if (contactId) conditions.push(eq(tasksTable.contactId, contactId));
  if (search) conditions.push(ilike(tasksTable.title, `%${search}%`));
  if (dueToday) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    conditions.push(gte(tasksTable.dueAt, start));
    conditions.push(lte(tasksTable.dueAt, end));
  }

  const [tasks, [{ total }], countRows] = await Promise.all([
    db.select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
      description: tasksTable.description,
      dueAt: tasksTable.dueAt,
      completedAt: tasksTable.completedAt,
      contactId: tasksTable.contactId,
      contactName: contactsTable.name,
      conversationId: tasksTable.conversationId,
      assignedMembershipId: tasksTable.assignedMembershipId,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
      .from(tasksTable)
      .leftJoin(contactsTable, eq(tasksTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(tasksTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(tasksTable).where(and(...conditions)),
    db.select({ status: tasksTable.status, cnt: count() })
      .from(tasksTable)
      .where(eq(tasksTable.workspaceId, activeWorkspaceId))
      .groupBy(tasksTable.status),
  ]);

  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.status] = Number(r.cnt);

  res.json({ tasks, total: Number(total), counts });
});

router.post("/", requirePermission("tasks:create"), async (req: AuthenticatedRequest, res: Response) => {
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

  const [task] = await db.insert(tasksTable).values({
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
    contactId: parsed.data.contactId,
    conversationId: parsed.data.conversationId,
    sourceMessageId: parsed.data.sourceMessageId,
    assignedMembershipId: parsed.data.assignedMembershipId,
    relatedType: parsed.data.relatedType,
    relatedId: parsed.data.relatedId,
    workspaceId: activeWorkspaceId,
    createdBy: userId,
    status: "pending",
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create",
    severity: "info",
    entityType: "task",
    entityId: task.id,
    entityLabel: task.title,
    newData: { title: task.title, priority: task.priority, status: task.status, contactId: task.contactId },
  });

  if (task.contactId) {
    await addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: task.contactId,
      eventType: "task_created",
      title: `تم إنشاء مهمة: ${task.title}`,
      entityType: "task",
      entityId: task.id,
      createdBy: userId,
    });
  }

  res.status(201).json({ task });
});

router.get("/:id", requirePermission("tasks:read"), async (req: AuthenticatedRequest, res: Response) => {
  const [task] = await db.select({
    id: tasksTable.id,
    title: tasksTable.title,
    status: tasksTable.status,
    priority: tasksTable.priority,
    description: tasksTable.description,
    dueAt: tasksTable.dueAt,
    completedAt: tasksTable.completedAt,
    contactId: tasksTable.contactId,
    conversationId: tasksTable.conversationId,
    sourceMessageId: tasksTable.sourceMessageId,
    assignedMembershipId: tasksTable.assignedMembershipId,
    createdBy: tasksTable.createdBy,
    createdAt: tasksTable.createdAt,
    updatedAt: tasksTable.updatedAt,
    contactName: contactsTable.name,
  })
    .from(tasksTable)
    .leftJoin(contactsTable, eq(tasksTable.contactId, contactsTable.id))
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);

  if (!task) { res.status(404).json({ error: "المهمة غير موجودة" }); return; }
  res.json({ task });
});

router.patch("/:id", requirePermission("tasks:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "المهمة غير موجودة" }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
  if ("dueAt" in parsed.data) updateData.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt as string) : null;
  if ("assignedMembershipId" in parsed.data) updateData.assignedMembershipId = parsed.data.assignedMembershipId;

  const [task] = await db.update(tasksTable)
    .set(updateData)
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "task",
    entityId: task.id,
    entityLabel: task.title,
    oldData: { title: existing.title, priority: existing.priority },
    newData: parsed.data as Record<string, unknown>,
  });

  if (task.contactId) {
    await addContactTimeline({
      workspaceId: req.sessionUser.activeWorkspaceId,
      contactId: task.contactId,
      eventType: "task_updated",
      title: `تم تحديث المهمة: ${task.title}`,
      entityType: "task",
      entityId: task.id,
      createdBy: req.sessionUser.userId,
    });
  }

  res.json({ task });
});

router.patch("/:id/status", requirePermission("tasks:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "المهمة غير موجودة" }); return; }

  const from = existing.status as TaskStatus;
  const to = parsed.data.status;

  if (!canTransition(from, to)) {
    res.status(422).json({
      error: `لا يمكن تغيير حالة المهمة من "${from}" إلى "${to}"`,
      code: "INVALID_TRANSITION",
    });
    return;
  }

  const setData: Record<string, unknown> = { status: to, updatedAt: new Date() };
  if (to === "done") {
    setData.completedAt = new Date();
    setData.completedBy = req.sessionUser.userId;
  }

  const [task] = await db.update(tasksTable)
    .set(setData)
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "task",
    entityId: task.id,
    entityLabel: task.title,
    oldData: { status: from },
    newData: { status: to },
  });

  if (task.contactId) {
    await addContactTimeline({
      workspaceId: req.sessionUser.activeWorkspaceId,
      contactId: task.contactId,
      eventType: to === "done" ? "task_completed" : "task_status_changed",
      title: to === "done" ? `تم إنجاز المهمة: ${task.title}` : `مهمة "${task.title}": تغيّرت الحالة إلى ${to}`,
      entityType: "task",
      entityId: task.id,
      createdBy: req.sessionUser.userId,
      metadata: { from, to },
    });
  }

  res.json({ task });
});

router.delete("/:id", requirePermission("tasks:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const [existing] = await db.select({ id: tasksTable.id, title: tasksTable.title, contactId: tasksTable.contactId })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "المهمة غير موجودة" }); return; }

  await db.delete(tasksTable)
    .where(and(eq(tasksTable.id, req.params.id as string), eq(tasksTable.workspaceId, req.sessionUser.activeWorkspaceId)));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete",
    severity: "warning",
    entityType: "task",
    entityId: existing.id,
    entityLabel: existing.title,
  });

  res.json({ ok: true });
});

export default router;
