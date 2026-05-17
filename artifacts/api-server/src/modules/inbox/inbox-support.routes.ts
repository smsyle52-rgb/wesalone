import { Router, type Response } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import {
  businessHoursTable,
  db,
  quickRepliesTable,
  savedViewsTable,
  slaRulesTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import { subscribeWorkspaceEvents, type WorkspaceRealtimeEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const quickReplySchema = z.object({
  shortcut: z.string().min(1).max(40).transform((value) => value.startsWith("/") ? value : `/${value}`),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
});

const savedViewSchema = z.object({
  name: z.string().min(1).max(120),
  resource: z.literal("conversations").default("conversations"),
  filters: z.record(z.string(), z.unknown()).default({}),
  isPinned: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  workspaceWide: z.boolean().default(false),
});

const savedViewReorderSchema = z.object({
  ids: z.array(z.string().uuid()).max(100),
});

const slaRuleSchema = z.object({
  name: z.string().min(1).max(120),
  channelType: z.string().max(50).nullable().optional(),
  priority: z.string().max(30).nullable().optional(),
  firstResponseMinutes: z.number().int().positive().max(10080),
  resolutionMinutes: z.number().int().positive().max(43200).nullable().optional(),
  active: z.boolean().default(true),
});

const businessHourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  isClosed: z.boolean().default(false),
  timezone: z.string().min(1).max(80).default("Asia/Aden"),
});

function zodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "بيانات غير صحيحة";
}

router.get("/inbox/stream", requirePermission("conversations:read"), (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.sessionUser.activeWorkspaceId;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: WorkspaceRealtimeEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: "connected", workspaceId, createdAt: new Date().toISOString() });
  const unsubscribe = subscribeWorkspaceEvents(workspaceId, send);
  const heartbeat = setInterval(() => {
    res.write("event: heartbeat\n");
    res.write(`data: ${JSON.stringify({ ok: true, ts: new Date().toISOString() })}\n\n`);
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

router.get("/quick-replies", requirePermission("quick_replies:read"), async (req: AuthenticatedRequest, res: Response) => {
  const rows = await db.select()
    .from(quickRepliesTable)
    .where(and(eq(quickRepliesTable.workspaceId, req.sessionUser.activeWorkspaceId), isNull(quickRepliesTable.archivedAt)))
    .orderBy(asc(quickRepliesTable.shortcut));
  res.json({ quickReplies: rows });
});

router.post("/quick-replies", requirePermission("quick_replies:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = quickReplySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }

  const [row] = await db.insert(quickRepliesTable).values({
    ...parsed.data,
    workspaceId: req.sessionUser.activeWorkspaceId,
    createdBy: req.sessionUser.userId,
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create",
    severity: "info",
    entityType: "quick_reply",
    entityId: row.id,
    entityLabel: row.shortcut,
    newData: { shortcut: row.shortcut, title: row.title },
  });

  res.status(201).json({ quickReply: row });
});

router.patch("/quick-replies/:id", requirePermission("quick_replies:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = quickReplySchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }

  const [row] = await db.update(quickRepliesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(quickRepliesTable.id, req.params.id as string), eq(quickRepliesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();

  if (!row) { res.status(404).json({ error: "الرد السريع غير موجود" }); return; }
  res.json({ quickReply: row });
});

router.delete("/quick-replies/:id", requirePermission("quick_replies:write"), async (req: AuthenticatedRequest, res: Response) => {
  const [row] = await db.update(quickRepliesTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quickRepliesTable.id, req.params.id as string), eq(quickRepliesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "الرد السريع غير موجود" }); return; }
  res.json({ ok: true });
});

router.get("/saved-views", requirePermission("saved_views:read"), async (req: AuthenticatedRequest, res: Response) => {
  const resource = (req.query.resource as string) || "conversations";
  const rows = await db.select()
    .from(savedViewsTable)
    .where(and(
      eq(savedViewsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      eq(savedViewsTable.resource, resource),
      isNull(savedViewsTable.archivedAt),
      or(isNull(savedViewsTable.userId), eq(savedViewsTable.userId, req.sessionUser.userId))!,
    ))
    .orderBy(desc(savedViewsTable.isPinned), asc(savedViewsTable.sortOrder), asc(savedViewsTable.name));
  res.json({ savedViews: rows });
});

router.post("/saved-views", requirePermission("saved_views:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = savedViewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }

  const [row] = await db.insert(savedViewsTable).values({
    workspaceId: req.sessionUser.activeWorkspaceId,
    userId: parsed.data.workspaceWide ? null : req.sessionUser.userId,
    name: parsed.data.name,
    resource: parsed.data.resource,
    filters: parsed.data.filters,
    isPinned: parsed.data.isPinned,
    sortOrder: parsed.data.sortOrder,
  }).returning();
  res.status(201).json({ savedView: row });
});

router.patch("/saved-views/:id", requirePermission("saved_views:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = savedViewSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }

  const values: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) values.name = parsed.data.name;
  if (parsed.data.resource !== undefined) values.resource = parsed.data.resource;
  if (parsed.data.filters !== undefined) values.filters = parsed.data.filters;
  if (parsed.data.isPinned !== undefined) values.isPinned = parsed.data.isPinned;
  if (parsed.data.sortOrder !== undefined) values.sortOrder = parsed.data.sortOrder;
  if (parsed.data.workspaceWide !== undefined) values.userId = parsed.data.workspaceWide ? null : req.sessionUser.userId;

  const [row] = await db.update(savedViewsTable)
    .set(values)
    .where(and(
      eq(savedViewsTable.id, req.params.id as string),
      eq(savedViewsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      isNull(savedViewsTable.archivedAt),
      or(isNull(savedViewsTable.userId), eq(savedViewsTable.userId, req.sessionUser.userId))!,
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "العرض المحفوظ غير موجود" }); return; }
  res.json({ savedView: row });
});

router.post("/saved-views/reorder", requirePermission("saved_views:write"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = savedViewReorderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }

  await Promise.all(parsed.data.ids.map((id, index) =>
    db.update(savedViewsTable)
      .set({ sortOrder: index })
      .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.workspaceId, req.sessionUser.activeWorkspaceId))),
  ));
  res.json({ ok: true });
});

router.delete("/saved-views/:id", requirePermission("saved_views:write"), async (req: AuthenticatedRequest, res: Response) => {
  const [row] = await db.update(savedViewsTable)
    .set({ archivedAt: new Date() })
    .where(and(
      eq(savedViewsTable.id, req.params.id as string),
      eq(savedViewsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      isNull(savedViewsTable.archivedAt),
      or(isNull(savedViewsTable.userId), eq(savedViewsTable.userId, req.sessionUser.userId))!,
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "العرض المحفوظ غير موجود" }); return; }
  res.json({ ok: true });
});

router.get("/sla-rules", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const rows = await db.select()
    .from(slaRulesTable)
    .where(and(eq(slaRulesTable.workspaceId, req.sessionUser.activeWorkspaceId), isNull(slaRulesTable.archivedAt)))
    .orderBy(desc(slaRulesTable.active), asc(slaRulesTable.name));
  res.json({ slaRules: rows });
});

router.post("/sla-rules", requirePermission("sla:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = slaRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }
  const [row] = await db.insert(slaRulesTable).values({
    ...parsed.data,
    workspaceId: req.sessionUser.activeWorkspaceId,
  }).returning();
  res.status(201).json({ slaRule: row });
});

router.patch("/sla-rules/:id", requirePermission("sla:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = slaRuleSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }
  const [row] = await db.update(slaRulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(slaRulesTable.id, req.params.id as string), eq(slaRulesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "قاعدة الاستجابة غير موجودة" }); return; }
  res.json({ slaRule: row });
});

router.delete("/sla-rules/:id", requirePermission("sla:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const [row] = await db.update(slaRulesTable)
    .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
    .where(and(eq(slaRulesTable.id, req.params.id as string), eq(slaRulesTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();
  if (!row) { res.status(404).json({ error: "قاعدة الاستجابة غير موجودة" }); return; }
  res.json({ ok: true });
});

router.get("/business-hours", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const rows = await db.select()
    .from(businessHoursTable)
    .where(eq(businessHoursTable.workspaceId, req.sessionUser.activeWorkspaceId))
    .orderBy(asc(businessHoursTable.dayOfWeek));
  res.json({ businessHours: rows });
});

router.put("/business-hours", requirePermission("business_hours:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = z.object({ days: z.array(businessHourSchema).length(7) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodError(parsed.error) }); return; }

  const rows = [];
  for (const day of parsed.data.days) {
    const [row] = await db.insert(businessHoursTable).values({
      workspaceId: req.sessionUser.activeWorkspaceId,
      dayOfWeek: day.dayOfWeek,
      openTime: day.openTime ?? null,
      closeTime: day.closeTime ?? null,
      isClosed: day.isClosed,
      timezone: day.timezone,
    })
      .onConflictDoUpdate({
        target: [businessHoursTable.workspaceId, businessHoursTable.dayOfWeek],
        set: {
          openTime: day.openTime ?? null,
          closeTime: day.closeTime ?? null,
          isClosed: day.isClosed,
          timezone: day.timezone,
        },
      })
      .returning();
    rows.push(row);
  }
  res.json({ businessHours: rows });
});

export default router;
