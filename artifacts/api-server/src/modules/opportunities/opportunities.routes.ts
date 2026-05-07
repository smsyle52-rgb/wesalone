import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, sum, ilike } from "drizzle-orm";
import {
  db, opportunitiesTable, contactsTable, conversationsTable,
  workspaceMembershipsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const VALID_STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;
const TERMINAL_STAGES: (typeof VALID_STAGES)[number][] = ["won", "lost"];

type OppStage = (typeof VALID_STAGES)[number];

const TRANSITIONS: Record<OppStage, OppStage[]> = {
  new: ["qualified", "lost"],
  qualified: ["proposal", "lost"],
  proposal: ["negotiation", "lost"],
  negotiation: ["won", "lost"],
  won: [],
  lost: [],
};

function canTransition(from: OppStage, to: OppStage): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const createSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب"),
  stage: z.enum(VALID_STAGES).default("new"),
  value: z.number().min(0).optional(),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
  contactId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
  assignedMembershipId: z.string().uuid().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  value: z.number().min(0).nullable().optional(),
  currency: z.enum(["YER", "SAR", "USD"]).optional(),
  assignedMembershipId: z.string().uuid().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().optional(),
});

const stageSchema = z.object({
  stage: z.enum(VALID_STAGES),
  lostReason: z.string().optional(),
});

router.get("/", requirePermission("opportunities:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const stage = req.query.stage as string | undefined;
  const search = req.query.search as string | undefined;
  const contactId = req.query.contactId as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(opportunitiesTable.workspaceId, activeWorkspaceId)];
  if (stage) conditions.push(eq(opportunitiesTable.stage, stage));
  if (contactId) conditions.push(eq(opportunitiesTable.contactId, contactId));
  if (search) conditions.push(ilike(opportunitiesTable.title, `%${search}%`));

  const [opportunities, [{ total }], stageCountRows, [{ pipelineValue }]] = await Promise.all([
    db.select({
      id: opportunitiesTable.id,
      title: opportunitiesTable.title,
      stage: opportunitiesTable.stage,
      value: opportunitiesTable.value,
      currency: opportunitiesTable.currency,
      probability: opportunitiesTable.probability,
      expectedCloseDate: opportunitiesTable.expectedCloseDate,
      notes: opportunitiesTable.notes,
      wonAt: opportunitiesTable.wonAt,
      lostAt: opportunitiesTable.lostAt,
      lostReason: opportunitiesTable.lostReason,
      contactId: opportunitiesTable.contactId,
      contactName: contactsTable.name,
      conversationId: opportunitiesTable.conversationId,
      assignedMembershipId: opportunitiesTable.assignedMembershipId,
      createdAt: opportunitiesTable.createdAt,
    })
      .from(opportunitiesTable)
      .leftJoin(contactsTable, eq(opportunitiesTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(opportunitiesTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(opportunitiesTable).where(and(...conditions)),
    db.select({ stage: opportunitiesTable.stage, cnt: count() })
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.workspaceId, activeWorkspaceId))
      .groupBy(opportunitiesTable.stage),
    db.select({ pipelineValue: sum(opportunitiesTable.value) })
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId))),
  ]);

  const stageCounts: Record<string, number> = {};
  for (const r of stageCountRows) stageCounts[r.stage] = Number(r.cnt);

  res.json({ opportunities, total: Number(total), pipelineValue: Number(pipelineValue ?? 0), stageCounts });
});

router.post("/", requirePermission("opportunities:create"), async (req: AuthenticatedRequest, res: Response) => {
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

  const [opportunity] = await db.insert(opportunitiesTable).values({
    title: parsed.data.title,
    stage: parsed.data.stage,
    value: parsed.data.value != null ? String(parsed.data.value) : null,
    currency: parsed.data.currency,
    contactId: parsed.data.contactId,
    conversationId: parsed.data.conversationId,
    sourceMessageId: parsed.data.sourceMessageId,
    assignedMembershipId: parsed.data.assignedMembershipId,
    probability: parsed.data.probability,
    expectedCloseDate: parsed.data.expectedCloseDate,
    notes: parsed.data.notes,
    workspaceId: activeWorkspaceId,
    createdBy: userId,
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create",
    severity: "info",
    entityType: "opportunity",
    entityId: opportunity.id,
    entityLabel: opportunity.title,
    newData: { title: opportunity.title, stage: opportunity.stage, value: opportunity.value, contactId: opportunity.contactId },
  });

  if (opportunity.contactId) {
    await addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: opportunity.contactId,
      eventType: "opportunity_created",
      title: `تم إنشاء فرصة: ${opportunity.title}`,
      entityType: "opportunity",
      entityId: opportunity.id,
      createdBy: userId,
    });
  }

  res.status(201).json({ opportunity });
});

router.get("/:id", requirePermission("opportunities:read"), async (req: AuthenticatedRequest, res: Response) => {
  const [opportunity] = await db.select({
    id: opportunitiesTable.id,
    title: opportunitiesTable.title,
    stage: opportunitiesTable.stage,
    value: opportunitiesTable.value,
    currency: opportunitiesTable.currency,
    probability: opportunitiesTable.probability,
    expectedCloseDate: opportunitiesTable.expectedCloseDate,
    notes: opportunitiesTable.notes,
    lostReason: opportunitiesTable.lostReason,
    wonAt: opportunitiesTable.wonAt,
    lostAt: opportunitiesTable.lostAt,
    contactId: opportunitiesTable.contactId,
    contactName: contactsTable.name,
    conversationId: opportunitiesTable.conversationId,
    sourceMessageId: opportunitiesTable.sourceMessageId,
    assignedMembershipId: opportunitiesTable.assignedMembershipId,
    createdBy: opportunitiesTable.createdBy,
    createdAt: opportunitiesTable.createdAt,
    updatedAt: opportunitiesTable.updatedAt,
  })
    .from(opportunitiesTable)
    .leftJoin(contactsTable, eq(opportunitiesTable.contactId, contactsTable.id))
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);

  if (!opportunity) { res.status(404).json({ error: "الفرصة غير موجودة" }); return; }
  res.json({ opportunity });
});

router.patch("/:id", requirePermission("opportunities:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(opportunitiesTable)
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "الفرصة غير موجودة" }); return; }

  if (TERMINAL_STAGES.includes(existing.stage as OppStage)) {
    res.status(422).json({ error: "لا يمكن تعديل فرصة مغلقة (ربح/خسارة)", code: "TERMINAL_STAGE" });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if ("value" in parsed.data) updateData.value = parsed.data.value != null ? String(parsed.data.value) : null;
  if (parsed.data.currency !== undefined) updateData.currency = parsed.data.currency;
  if ("assignedMembershipId" in parsed.data) updateData.assignedMembershipId = parsed.data.assignedMembershipId;
  if ("probability" in parsed.data) updateData.probability = parsed.data.probability;
  if ("expectedCloseDate" in parsed.data) updateData.expectedCloseDate = parsed.data.expectedCloseDate;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [opportunity] = await db.update(opportunitiesTable)
    .set(updateData)
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "opportunity",
    entityId: opportunity.id,
    entityLabel: opportunity.title,
    oldData: { stage: existing.stage, value: existing.value },
    newData: parsed.data as Record<string, unknown>,
  });

  res.json({ opportunity });
});

router.patch("/:id/stage", requirePermission("opportunities:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }

  const [existing] = await db.select()
    .from(opportunitiesTable)
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "الفرصة غير موجودة" }); return; }

  const from = existing.stage as OppStage;
  const to = parsed.data.stage;

  if (!canTransition(from, to)) {
    res.status(422).json({
      error: `لا يمكن تغيير مرحلة الفرصة من "${from}" إلى "${to}"`,
      code: "INVALID_TRANSITION",
    });
    return;
  }

  if (to === "lost" && !parsed.data.lostReason?.trim()) {
    res.status(400).json({ error: "سبب الخسارة مطلوب عند وضع علامة خسارة على الفرصة" });
    return;
  }

  const setData: Record<string, unknown> = { stage: to, updatedAt: new Date() };
  if (to === "won") setData.wonAt = new Date();
  if (to === "lost") {
    setData.lostAt = new Date();
    setData.lostReason = parsed.data.lostReason;
  }

  const [opportunity] = await db.update(opportunitiesTable)
    .set(setData)
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "opportunity",
    entityId: opportunity.id,
    entityLabel: opportunity.title,
    oldData: { stage: from },
    newData: { stage: to, lostReason: parsed.data.lostReason },
  });

  if (opportunity.contactId) {
    await addContactTimeline({
      workspaceId: req.sessionUser.activeWorkspaceId,
      contactId: opportunity.contactId,
      eventType: "opportunity_stage_changed",
      title: `فرصة "${opportunity.title}": تغيّرت المرحلة إلى ${to}`,
      entityType: "opportunity",
      entityId: opportunity.id,
      createdBy: req.sessionUser.userId,
      metadata: { from, to, lostReason: parsed.data.lostReason },
    });
  }

  res.json({ opportunity });
});

router.delete("/:id", requirePermission("opportunities:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const [existing] = await db.select({ id: opportunitiesTable.id, title: opportunitiesTable.title, contactId: opportunitiesTable.contactId })
    .from(opportunitiesTable)
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "الفرصة غير موجودة" }); return; }

  await db.delete(opportunitiesTable)
    .where(and(eq(opportunitiesTable.id, req.params.id as string), eq(opportunitiesTable.workspaceId, req.sessionUser.activeWorkspaceId)));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete",
    severity: "warning",
    entityType: "opportunity",
    entityId: existing.id,
    entityLabel: existing.title,
  });

  res.json({ ok: true });
});

export default router;
