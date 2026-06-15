import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { reportDefinitionsTable, generatedReportsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { reportGenerateLimiter } from "../../lib/rateLimiter";

const router = Router();
router.use(requireSession);

const REPORT_TYPE_LABELS: Record<string, string> = {
  overview: "نظرة عامة",
  operations: "العمليات",
  sales: "المبيعات",
  finance: "الماليات",
  ai: "الذكاء الاصطناعي",
  team: "الفريق",
  channel: "القنوات",
};

async function buildReportData(workspaceId: string, type: string, dateFrom: Date, dateTo: Date): Promise<Record<string, unknown>> {
  const {
    contactsTable, conversationsTable, ticketsTable, tasksTable, followupsTable,
    opportunitiesTable, ordersTable, paymentsTable, debtsTable, aiRunsTable,
    aiSafetyEventsTable, approvalRequestsTable, messagesTable,
  } = await import("@workspace/db");
  const { count, sum, gte, lte, eq: eqOp, and: andOp, inArray: inArrayOp } = await import("drizzle-orm");

  if (type === "overview") {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [[{ totalContacts }], [{ openConversations }], [{ openTickets }], [{ ordersTotal }], [{ confirmedPayments }]] = await Promise.all([
      db.select({ totalContacts: count() }).from(contactsTable).where(eqOp(contactsTable.workspaceId, workspaceId)),
      db.select({ openConversations: count() }).from(conversationsTable).where(andOp(eqOp(conversationsTable.workspaceId, workspaceId), inArrayOp(conversationsTable.status, ["open", "new"]))),
      db.select({ openTickets: count() }).from(ticketsTable).where(andOp(eqOp(ticketsTable.workspaceId, workspaceId), eqOp(ticketsTable.status, "open"))),
      db.select({ ordersTotal: sum(ordersTable.totalAmount) }).from(ordersTable).where(andOp(eqOp(ordersTable.workspaceId, workspaceId), gte(ordersTable.createdAt, dateFrom), lte(ordersTable.createdAt, dateTo))),
      db.select({ confirmedPayments: sum(paymentsTable.amount) }).from(paymentsTable).where(andOp(eqOp(paymentsTable.workspaceId, workspaceId), eqOp(paymentsTable.status, "confirmed"), gte(paymentsTable.createdAt, dateFrom), lte(paymentsTable.createdAt, dateTo))),
    ]);
    return { totalContacts: Number(totalContacts), openConversations: Number(openConversations), openTickets: Number(openTickets), ordersTotal: Number(ordersTotal ?? 0), confirmedPayments: Number(confirmedPayments ?? 0) };
  }

  if (type === "finance") {
    const paymentRows = await db.select({ status: paymentsTable.status, count: count(), total: sum(paymentsTable.amount) }).from(paymentsTable)
      .where(andOp(eqOp(paymentsTable.workspaceId, workspaceId), gte(paymentsTable.createdAt, dateFrom), lte(paymentsTable.createdAt, dateTo))).groupBy(paymentsTable.status);
    const debtRows = await db.select({ count: count(), amount: sum(debtsTable.remainingAmount) }).from(debtsTable)
      .where(andOp(eqOp(debtsTable.workspaceId, workspaceId), inArrayOp(debtsTable.status, ["open", "partial", "overdue"])));
    return { paymentsByStatus: paymentRows.map((r) => ({ status: r.status, count: Number(r.count), total: Number(r.total ?? 0) })), debtsOpenAmount: Number(debtRows[0]?.amount ?? 0) };
  }

  if (type === "sales") {
    const [oppRows, orderRows] = await Promise.all([
      db.select({ stage: opportunitiesTable.stage, count: count(), value: sum(opportunitiesTable.value) }).from(opportunitiesTable)
        .where(andOp(eqOp(opportunitiesTable.workspaceId, workspaceId), gte(opportunitiesTable.createdAt, dateFrom), lte(opportunitiesTable.createdAt, dateTo))).groupBy(opportunitiesTable.stage),
      db.select({ status: ordersTable.status, count: count(), total: sum(ordersTable.totalAmount) }).from(ordersTable)
        .where(andOp(eqOp(ordersTable.workspaceId, workspaceId), gte(ordersTable.createdAt, dateFrom), lte(ordersTable.createdAt, dateTo))).groupBy(ordersTable.status),
    ]);
    return { opportunitiesByStage: oppRows.map((r) => ({ stage: r.stage, count: Number(r.count), value: Number(r.value ?? 0) })), ordersByStatus: orderRows.map((r) => ({ status: r.status, count: Number(r.count), total: Number(r.total ?? 0) })) };
  }

  if (type === "operations") {
    const [ticketRows, taskRows] = await Promise.all([
      db.select({ status: ticketsTable.status, count: count() }).from(ticketsTable).where(andOp(eqOp(ticketsTable.workspaceId, workspaceId), gte(ticketsTable.createdAt, dateFrom), lte(ticketsTable.createdAt, dateTo))).groupBy(ticketsTable.status),
      db.select({ status: tasksTable.status, count: count() }).from(tasksTable).where(andOp(eqOp(tasksTable.workspaceId, workspaceId), gte(tasksTable.createdAt, dateFrom), lte(tasksTable.createdAt, dateTo))).groupBy(tasksTable.status),
    ]);
    return { ticketsByStatus: ticketRows.map((r) => ({ status: r.status, count: Number(r.count) })), tasksByStatus: taskRows.map((r) => ({ status: r.status, count: Number(r.count) })) };
  }

  if (type === "ai") {
    const [runsByTask, safety, approvals] = await Promise.all([
      db.select({ taskType: aiRunsTable.taskType, count: count() }).from(aiRunsTable).where(andOp(eqOp(aiRunsTable.workspaceId, workspaceId), gte(aiRunsTable.createdAt, dateFrom), lte(aiRunsTable.createdAt, dateTo))).groupBy(aiRunsTable.taskType),
      db.select({ count: count() }).from(aiSafetyEventsTable).where(andOp(eqOp(aiSafetyEventsTable.workspaceId, workspaceId), gte(aiSafetyEventsTable.createdAt, dateFrom), lte(aiSafetyEventsTable.createdAt, dateTo))),
      db.select({ status: approvalRequestsTable.status, count: count() }).from(approvalRequestsTable).where(andOp(eqOp(approvalRequestsTable.workspaceId, workspaceId), gte(approvalRequestsTable.createdAt, dateFrom), lte(approvalRequestsTable.createdAt, dateTo))).groupBy(approvalRequestsTable.status),
    ]);
    return { runsByTaskType: runsByTask.map((r) => ({ taskType: r.taskType, count: Number(r.count) })), safetyBlockedCount: Number(safety[0]?.count ?? 0), approvalsByStatus: approvals.map((r) => ({ status: r.status, count: Number(r.count) })) };
  }

  if (type === "team") {
    const [msgRows] = await Promise.all([
      db.select({ count: count() }).from(messagesTable).where(andOp(eqOp(messagesTable.workspaceId, workspaceId), gte(messagesTable.createdAt, dateFrom), lte(messagesTable.createdAt, dateTo))),
    ]);
    return { totalMessages: Number(msgRows[0]?.count ?? 0) };
  }

  if (type === "channel") {
    const convRows = await db.select({ channel: conversationsTable.channel, count: count() }).from(conversationsTable)
      .where(andOp(eqOp(conversationsTable.workspaceId, workspaceId), gte(conversationsTable.createdAt, dateFrom), lte(conversationsTable.createdAt, dateTo))).groupBy(conversationsTable.channel);
    return { conversationsByChannel: convRows.map((r) => ({ channel: r.channel, count: Number(r.count) })) };
  }

  return {};
}

// ─── Report Definitions ───────────────────────────────────────────────────────

router.get("/definitions", requirePermission("reports:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const definitions = await db.select().from(reportDefinitionsTable)
    .where(and(eq(reportDefinitionsTable.workspaceId, activeWorkspaceId), eq(reportDefinitionsTable.isArchived, false)))
    .orderBy(desc(reportDefinitionsTable.createdAt));
  res.json({ definitions });
});

const defCreateSchema = z.object({
  name: z.string().trim().min(1, "اسم التقرير مطلوب").max(200),
  type: z.enum(["overview", "operations", "sales", "finance", "ai", "team", "channel"]).default("overview"),
  description: z.string().trim().max(1000).optional().nullable(),
  config: z.record(z.unknown()).default({}),
});

router.post("/definitions", requirePermission("reports:create"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = defCreateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const [def] = await db.insert(reportDefinitionsTable).values({
    workspaceId: activeWorkspaceId,
    name: parse.data.name,
    type: parse.data.type,
    description: parse.data.description ?? null,
    config: parse.data.config,
    createdBy: userId,
  }).returning();

  await createAuditLog({ ...auditFromRequest(req, req.sessionUser), action: "report_definition_create", entityType: "report_definition", entityId: def.id, newData: { name: def.name, type: def.type } });

  res.status(201).json({ definition: def });
});

router.patch("/definitions/:id", requirePermission("reports:update"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const id = String(req.params.id);
  const parse = defCreateSchema.partial().safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const [existing] = await db.select().from(reportDefinitionsTable).where(and(eq(reportDefinitionsTable.id, id), eq(reportDefinitionsTable.workspaceId, activeWorkspaceId)));
  if (!existing) { res.status(404).json({ error: "التقرير غير موجود" }); return; }

  const [updated] = await db.update(reportDefinitionsTable).set({ ...parse.data, updatedAt: new Date() })
    .where(and(eq(reportDefinitionsTable.id, id), eq(reportDefinitionsTable.workspaceId, activeWorkspaceId))).returning();
  await createAuditLog({ ...auditFromRequest(req, req.sessionUser), action: "report_definition_update", entityType: "report_definition", entityId: id, oldData: { name: existing.name }, newData: { name: updated.name } });

  res.json({ definition: updated });
});

router.delete("/definitions/:id", requirePermission("reports:delete"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const [existing] = await db.select().from(reportDefinitionsTable).where(and(eq(reportDefinitionsTable.id, id), eq(reportDefinitionsTable.workspaceId, activeWorkspaceId)));
  if (!existing) { res.status(404).json({ error: "التقرير غير موجود" }); return; }

  await db.update(reportDefinitionsTable).set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(reportDefinitionsTable.id, id), eq(reportDefinitionsTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({ ...auditFromRequest(req, req.sessionUser), action: "report_definition_delete", entityType: "report_definition", entityId: id, oldData: { name: existing.name } });

  res.json({ success: true, message: "تم أرشفة التقرير" });
});

// ─── Generate Report ──────────────────────────────────────────────────────────

const generateSchema = z.object({
  type: z.enum(["overview", "operations", "sales", "finance", "ai", "team", "channel"]).default("overview"),
  title: z.string().trim().max(300).optional(),
  reportDefinitionId: z.string().uuid().optional().nullable(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

router.post("/generate", reportGenerateLimiter, requirePermission("reports:generate"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parse = generateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "بيانات غير صالحة", details: parse.error.flatten() }); return; }

  const { type, reportDefinitionId } = parse.data;

  const today = new Date();
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(today.getDate() - 30);
  const dateFrom = parse.data.dateFrom ? new Date(parse.data.dateFrom) : thirtyDaysAgo;
  const dateTo = parse.data.dateTo ? new Date(parse.data.dateTo) : today;
  dateTo.setHours(23, 59, 59, 999);

  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) { res.status(400).json({ error: "تاريخ غير صالح" }); return; }

  const title = parse.data.title ?? `تقرير ${REPORT_TYPE_LABELS[type] ?? type} — ${dateFrom.toISOString().split("T")[0]} إلى ${dateTo.toISOString().split("T")[0]}`;

  let data: Record<string, unknown> = {};
  let status: "generated" | "failed" = "generated";
  try {
    data = await buildReportData(activeWorkspaceId, type, dateFrom, dateTo);
  } catch (err) {
    status = "failed";
    data = { error: "فشل في توليد التقرير" };
  }

  const [report] = await db.insert(generatedReportsTable).values({
    workspaceId: activeWorkspaceId,
    reportDefinitionId: reportDefinitionId ?? null,
    type,
    title,
    dateFrom: dateFrom.toISOString().split("T")[0],
    dateTo: dateTo.toISOString().split("T")[0],
    status,
    data,
    generatedBy: userId,
  }).returning();

  await createAuditLog({ ...auditFromRequest(req, req.sessionUser), action: "report_generate", entityType: "generated_report", entityId: report.id, newData: { type, dateFrom: report.dateFrom, dateTo: report.dateTo } });

  res.status(201).json({ report });
});

// ─── Generated Reports List ───────────────────────────────────────────────────

router.get("/generated", requirePermission("reports:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20")) || 20);
  const reports = await db.select().from(generatedReportsTable)
    .where(eq(generatedReportsTable.workspaceId, activeWorkspaceId))
    .orderBy(desc(generatedReportsTable.createdAt))
    .limit(limit);
  res.json({ reports });
});

router.get("/generated/:id", requirePermission("reports:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const [report] = await db.select().from(generatedReportsTable)
    .where(and(eq(generatedReportsTable.id, id), eq(generatedReportsTable.workspaceId, activeWorkspaceId)));
  if (!report) { res.status(404).json({ error: "التقرير غير موجود أو لا تملك صلاحية عرضه" }); return; }
  res.json({ report });
});

export default router;
