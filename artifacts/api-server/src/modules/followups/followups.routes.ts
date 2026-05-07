import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, ilike, lte } from "drizzle-orm";
import {
  db, followupsTable, contactsTable, conversationsTable,
  opportunitiesTable, workspaceMembershipsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const VALID_STATUSES = ["pending", "done", "skipped", "overdue"] as const;
const VALID_TYPES = ["manual", "sales", "support", "collection", "reminder"] as const;

type FollowupStatus = (typeof VALID_STATUSES)[number];

const TRANSITIONS: Record<FollowupStatus, FollowupStatus[]> = {
  pending: ["done", "skipped", "overdue"],
  overdue: ["done", "skipped"],
  done: [],
  skipped: [],
};

function canTransition(from: FollowupStatus, to: FollowupStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const createSchema = z.object({
  contactId: z.string().uuid("معرّف العميل غير صحيح"),
  conversationId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  assignedMembershipId: z.string().uuid().optional(),
  type: z.enum(VALID_TYPES).default("manual"),
  dueAt: z.string().datetime("تاريخ الموعد غير صحيح"),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  type: z.enum(VALID_TYPES).optional(),
  dueAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  assignedMembershipId: z.string().uuid().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  skippedReason: z.string().optional(),
});

router.get("/", requirePermission("followups:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = req.query.status as string | undefined;
  const contactId = req.query.contactId as string | undefined;
  const type = req.query.type as string | undefined;
  const overdue = req.query.overdue === "true";
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(followupsTable.workspaceId, activeWorkspaceId)];
  if (status) conditions.push(eq(followupsTable.status, status));
  if (contactId) conditions.push(eq(followupsTable.contactId, contactId));
  if (type) conditions.push(eq(followupsTable.type, type));
  if (overdue) {
    conditions.push(eq(followupsTable.status, "pending"));
    conditions.push(lte(followupsTable.dueAt, new Date()));
  }

  const [followups, [{ total }], countRows] = await Promise.all([
    db.select({
      id: followupsTable.id,
      type: followupsTable.type,
      status: followupsTable.status,
      dueAt: followupsTable.dueAt,
      notes: followupsTable.notes,
      completedAt: followupsTable.completedAt,
      skippedReason: followupsTable.skippedReason,
      contactId: followupsTable.contactId,
      contactName: contactsTable.name,
      conversationId: followupsTable.conversationId,
      opportunityId: followupsTable.opportunityId,
      assignedMembershipId: followupsTable.assignedMembershipId,
      createdAt: followupsTable.createdAt,
    })
      .from(followupsTable)
      .leftJoin(contactsTable, eq(followupsTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(followupsTable.dueAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(followupsTable).where(and(...conditions)),
    db.select({ status: followupsTable.status, cnt: count() })
      .from(followupsTable)
      .where(eq(followupsTable.workspaceId, activeWorkspaceId))
      .groupBy(followupsTable.status),
  ]);

  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.status] = Number(r.cnt);

  res.json({ followups, total: Number(total), counts });
});

router.post("/", requirePermission("followups:create"), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body.contactId) {
    res.status(400).json({ error: "يجب اختيار عميل لإنشاء متابعة" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const { activeWorkspaceId, userId } = req.sessionUser;

  const [contact] = await db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable)
    .where(and(eq(contactsTable.id, parsed.data.contactId), eq(contactsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!contact) { res.status(404).json({ error: "العميل غير موجود أو لا ينتمي لهذا الحساب" }); return; }

  if (parsed.data.conversationId) {
    const [c] = await db.select({ id: conversationsTable.id }).from(conversationsTable)
      .where(and(eq(conversationsTable.id, parsed.data.conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!c) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا الحساب" }); return; }
  }

  if (parsed.data.opportunityId) {
    const [o] = await db.select({ id: opportunitiesTable.id }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, parsed.data.opportunityId), eq(opportunitiesTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!o) { res.status(404).json({ error: "الفرصة غير موجودة أو لا تنتمي لهذا الحساب" }); return; }
  }

  const [followup] = await db.insert(followupsTable).values({
    contactId: parsed.data.contactId,
    conversationId: parsed.data.conversationId,
    opportunityId: parsed.data.opportunityId,
    assignedMembershipId: parsed.data.assignedMembershipId,
    type: parsed.data.type,
    dueAt: new Date(parsed.data.dueAt),
    notes: parsed.data.notes,
    workspaceId: activeWorkspaceId,
    createdBy: userId,
    status: "pending",
  }).returning();

  const typeLabel = { manual: "يدوي", sales: "مبيعات", support: "دعم", collection: "تحصيل", reminder: "تذكير" }[followup.type] ?? followup.type;

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create",
    severity: "info",
    entityType: "followup",
    entityId: followup.id,
    entityLabel: `متابعة ${typeLabel} — ${contact.name}`,
    newData: { type: followup.type, dueAt: followup.dueAt, contactId: followup.contactId },
  });

  await addContactTimeline({
    workspaceId: activeWorkspaceId,
    contactId: followup.contactId!,
    eventType: "followup_created",
    title: `تم إنشاء متابعة ${typeLabel}`,
    entityType: "followup",
    entityId: followup.id,
    createdBy: userId,
  });

  res.status(201).json({ followup });
});

router.get("/:id", requirePermission("followups:read"), async (req: AuthenticatedRequest, res: Response) => {
  const [followup] = await db.select({
    id: followupsTable.id,
    type: followupsTable.type,
    status: followupsTable.status,
    dueAt: followupsTable.dueAt,
    notes: followupsTable.notes,
    completedAt: followupsTable.completedAt,
    skippedReason: followupsTable.skippedReason,
    contactId: followupsTable.contactId,
    contactName: contactsTable.name,
    conversationId: followupsTable.conversationId,
    opportunityId: followupsTable.opportunityId,
    assignedMembershipId: followupsTable.assignedMembershipId,
    createdBy: followupsTable.createdBy,
    createdAt: followupsTable.createdAt,
    updatedAt: followupsTable.updatedAt,
  })
    .from(followupsTable)
    .leftJoin(contactsTable, eq(followupsTable.contactId, contactsTable.id))
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);

  if (!followup) { res.status(404).json({ error: "المتابعة غير موجودة" }); return; }
  res.json({ followup });
});

router.patch("/:id", requirePermission("followups:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(followupsTable)
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "المتابعة غير موجودة" }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.dueAt !== undefined) updateData.dueAt = new Date(parsed.data.dueAt);
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if ("assignedMembershipId" in parsed.data) updateData.assignedMembershipId = parsed.data.assignedMembershipId;

  const [followup] = await db.update(followupsTable)
    .set(updateData)
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "followup",
    entityId: followup.id,
    entityLabel: `متابعة — ${existing.contactId}`,
    newData: parsed.data as Record<string, unknown>,
  });

  res.json({ followup });
});

router.patch("/:id/status", requirePermission("followups:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(followupsTable)
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "المتابعة غير موجودة" }); return; }

  const from = existing.status as FollowupStatus;
  const to = parsed.data.status;

  if (!canTransition(from, to)) {
    res.status(422).json({
      error: `لا يمكن تغيير حالة المتابعة من "${from}" إلى "${to}"`,
      code: "INVALID_TRANSITION",
    });
    return;
  }

  if (to === "skipped" && !parsed.data.skippedReason?.trim()) {
    res.status(400).json({ error: "سبب التخطي مطلوب عند تحديد الحالة إلى 'تم التخطي'" });
    return;
  }

  const setData: Record<string, unknown> = { status: to, updatedAt: new Date() };
  if (to === "done") {
    setData.completedAt = new Date();
    setData.completedBy = req.sessionUser.userId;
  }
  if (to === "skipped") {
    setData.skippedReason = parsed.data.skippedReason;
  }

  const [followup] = await db.update(followupsTable)
    .set(setData)
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  const typeLabel = { manual: "يدوي", sales: "مبيعات", support: "دعم", collection: "تحصيل", reminder: "تذكير" }[followup.type] ?? followup.type;

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "followup",
    entityId: followup.id,
    entityLabel: `متابعة ${typeLabel}`,
    oldData: { status: from },
    newData: { status: to, skippedReason: parsed.data.skippedReason },
  });

  if (followup.contactId) {
    await addContactTimeline({
      workspaceId: req.sessionUser.activeWorkspaceId,
      contactId: followup.contactId,
      eventType: to === "done" ? "followup_done" : "followup_status_changed",
      title: to === "done" ? `تم إتمام المتابعة ${typeLabel}` : `متابعة: تغيّرت الحالة إلى ${to}`,
      entityType: "followup",
      entityId: followup.id,
      createdBy: req.sessionUser.userId,
      metadata: { from, to, skippedReason: parsed.data.skippedReason },
    });
  }

  res.json({ followup });
});

router.delete("/:id", requirePermission("followups:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const [existing] = await db.select({ id: followupsTable.id, type: followupsTable.type, contactId: followupsTable.contactId })
    .from(followupsTable)
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "المتابعة غير موجودة" }); return; }

  await db.delete(followupsTable)
    .where(and(eq(followupsTable.id, req.params.id as string), eq(followupsTable.workspaceId, req.sessionUser.activeWorkspaceId)));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete",
    severity: "warning",
    entityType: "followup",
    entityId: existing.id,
    entityLabel: `متابعة — ${existing.contactId}`,
  });

  res.json({ ok: true });
});

export default router;
