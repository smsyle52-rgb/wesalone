import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  contactsTable, conversationsTable, messagesTable, ticketsTable, tasksTable,
  followupsTable, opportunitiesTable, ordersTable, paymentsTable, debtsTable,
  aiRunsTable, aiUsageTable, aiSafetyEventsTable, approvalRequestsTable,
  usersTable, workspaceMembershipsTable,
} from "@workspace/db";
import { eq, and, count, sum, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

function parseDateRange(query: Record<string, unknown>): { dateFrom: Date; dateTo: Date } {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const dateFrom = query.date_from ? new Date(String(query.date_from)) : thirtyDaysAgo;
  const dateTo = query.date_to ? new Date(String(query.date_to)) : today;
  if (isNaN(dateFrom.getTime())) return { dateFrom: thirtyDaysAgo, dateTo: today };
  if (isNaN(dateTo.getTime())) return { dateFrom: thirtyDaysAgo, dateTo: today };
  dateTo.setHours(23, 59, 59, 999);
  return { dateFrom, dateTo };
}

// ─── Overview ─────────────────────────────────────────────────────────────────

router.get("/overview", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const [
    [{ totalContacts }],
    [{ openConversations }],
    [{ msgsToday }],
    [{ openTickets }],
    [{ pendingTasks }],
    [{ overdueFollowups }],
    [{ openOpportunities }],
    [{ ordersToday }],
    [{ paymentsConfirmedToday }],
    [{ openDebtsAmount }],
    [{ aiRunsToday }],
  ] = await Promise.all([
    db.select({ totalContacts: count() }).from(contactsTable).where(eq(contactsTable.workspaceId, activeWorkspaceId)),
    db.select({ openConversations: count() }).from(conversationsTable).where(and(eq(conversationsTable.workspaceId, activeWorkspaceId), inArray(conversationsTable.status, ["open", "new"]))),
    db.select({ msgsToday: count() }).from(messagesTable).where(and(eq(messagesTable.workspaceId, activeWorkspaceId), gte(messagesTable.createdAt, todayStart))),
    db.select({ openTickets: count() }).from(ticketsTable).where(and(eq(ticketsTable.workspaceId, activeWorkspaceId), eq(ticketsTable.status, "open"))),
    db.select({ pendingTasks: count() }).from(tasksTable).where(and(eq(tasksTable.workspaceId, activeWorkspaceId), eq(tasksTable.status, "pending"))),
    db.select({ overdueFollowups: count() }).from(followupsTable).where(and(eq(followupsTable.workspaceId, activeWorkspaceId), eq(followupsTable.status, "overdue"))),
    db.select({ openOpportunities: count() }).from(opportunitiesTable).where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId), inArray(opportunitiesTable.stage, ["new", "qualified", "proposal", "negotiation"]))),
    db.select({ ordersToday: count() }).from(ordersTable).where(and(eq(ordersTable.workspaceId, activeWorkspaceId), gte(ordersTable.createdAt, todayStart))),
    db.select({ paymentsConfirmedToday: sum(paymentsTable.amount) }).from(paymentsTable).where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.status, "confirmed"), gte(paymentsTable.createdAt, todayStart))),
    db.select({ openDebtsAmount: sum(debtsTable.remainingAmount) }).from(debtsTable).where(and(eq(debtsTable.workspaceId, activeWorkspaceId), inArray(debtsTable.status, ["open", "partial", "overdue"]))),
    db.select({ aiRunsToday: count() }).from(aiRunsTable).where(and(eq(aiRunsTable.workspaceId, activeWorkspaceId), gte(aiRunsTable.createdAt, todayStart))),
  ]);

  res.json({
    _meta: {
      scopeNote: "current_and_today_snapshot",
      usesDateRange: false,
      note: "هذا الـ endpoint يعرض لقطة حالية (current state) ونشاط اليوم فقط. النطاق الزمني date_from/date_to غير مؤثر هنا. للتحليل حسب النطاق الزمني استخدم endpoints: operations, sales, finance, ai, channels",
    },
    dateFrom, dateTo,
    totalContacts: Number(totalContacts),
    openConversations: Number(openConversations),
    messagesCount: Number(msgsToday),
    openTickets: Number(openTickets),
    pendingTasks: Number(pendingTasks),
    overdueFollowups: Number(overdueFollowups),
    openOpportunities: Number(openOpportunities),
    ordersToday: Number(ordersToday),
    paymentsConfirmedToday: Number(paymentsConfirmedToday ?? 0),
    openDebtsAmount: Number(openDebtsAmount ?? 0),
    aiRunsToday: Number(aiRunsToday),
  });
});

// ─── Operations ───────────────────────────────────────────────────────────────

router.get("/operations", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);

  const [ticketRows, taskRows, followupRows, overdueFollowupRows, opportunityRows] = await Promise.all([
    db.select({ status: ticketsTable.status, count: count() }).from(ticketsTable)
      .where(and(eq(ticketsTable.workspaceId, activeWorkspaceId), gte(ticketsTable.createdAt, dateFrom), lte(ticketsTable.createdAt, dateTo)))
      .groupBy(ticketsTable.status),
    db.select({ status: tasksTable.status, count: count() }).from(tasksTable)
      .where(and(eq(tasksTable.workspaceId, activeWorkspaceId), gte(tasksTable.createdAt, dateFrom), lte(tasksTable.createdAt, dateTo)))
      .groupBy(tasksTable.status),
    db.select({ status: followupsTable.status, count: count() }).from(followupsTable)
      .where(and(eq(followupsTable.workspaceId, activeWorkspaceId), gte(followupsTable.createdAt, dateFrom), lte(followupsTable.createdAt, dateTo)))
      .groupBy(followupsTable.status),
    db.select({ count: count() }).from(followupsTable)
      .where(and(eq(followupsTable.workspaceId, activeWorkspaceId), eq(followupsTable.status, "overdue"))),
    db.select({ stage: opportunitiesTable.stage, count: count() }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId), gte(opportunitiesTable.createdAt, dateFrom), lte(opportunitiesTable.createdAt, dateTo)))
      .groupBy(opportunitiesTable.stage),
  ]);

  res.json({
    dateFrom, dateTo,
    ticketsByStatus: ticketRows.map((r) => ({ status: r.status, count: Number(r.count) })),
    tasksByStatus: taskRows.map((r) => ({ status: r.status, count: Number(r.count) })),
    followupsByStatus: followupRows.map((r) => ({ status: r.status, count: Number(r.count) })),
    overdueFollowups: Number(overdueFollowupRows[0]?.count ?? 0),
    opportunitiesByStage: opportunityRows.map((r) => ({ stage: r.stage, count: Number(r.count) })),
  });
});

// ─── Sales ────────────────────────────────────────────────────────────────────

router.get("/sales", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);

  const [opportunityRows, wonRows, lostRows, orderRows] = await Promise.all([
    db.select({ stage: opportunitiesTable.stage, valueSum: sum(opportunitiesTable.value), count: count() }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId), gte(opportunitiesTable.createdAt, dateFrom), lte(opportunitiesTable.createdAt, dateTo)))
      .groupBy(opportunitiesTable.stage),
    db.select({ count: count(), valueSum: sum(opportunitiesTable.value) }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId), eq(opportunitiesTable.stage, "won"), gte(opportunitiesTable.createdAt, dateFrom), lte(opportunitiesTable.createdAt, dateTo))),
    db.select({ count: count() }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId), eq(opportunitiesTable.stage, "lost"), gte(opportunitiesTable.createdAt, dateFrom), lte(opportunitiesTable.createdAt, dateTo))),
    db.select({ status: ordersTable.status, count: count(), total: sum(ordersTable.totalAmount) }).from(ordersTable)
      .where(and(eq(ordersTable.workspaceId, activeWorkspaceId), gte(ordersTable.createdAt, dateFrom), lte(ordersTable.createdAt, dateTo)))
      .groupBy(ordersTable.status),
  ]);

  const ordersTotal = orderRows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const ordersCount = orderRows.reduce((s, r) => s + Number(r.count), 0);
  const avgOrderValue = ordersCount > 0 ? ordersTotal / ordersCount : 0;

  res.json({
    dateFrom, dateTo,
    opportunitiesByStage: opportunityRows.map((r) => ({ stage: r.stage, count: Number(r.count), value: Number(r.valueSum ?? 0) })),
    wonCount: Number(wonRows[0]?.count ?? 0),
    wonValue: Number(wonRows[0]?.valueSum ?? 0),
    lostCount: Number(lostRows[0]?.count ?? 0),
    ordersByStatus: orderRows.map((r) => ({ status: r.status, count: Number(r.count), total: Number(r.total ?? 0) })),
    ordersCount,
    ordersTotal,
    avgOrderValue,
  });
});

// ─── Finance ──────────────────────────────────────────────────────────────────

router.get("/finance", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);

  const [paymentRows, debtRows, overdueDebtRows, collectionNoteCount] = await Promise.all([
    db.select({ status: paymentsTable.status, count: count(), total: sum(paymentsTable.amount) }).from(paymentsTable)
      .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), gte(paymentsTable.createdAt, dateFrom), lte(paymentsTable.createdAt, dateTo)))
      .groupBy(paymentsTable.status),
    db.select({ count: count(), amount: sum(debtsTable.remainingAmount) }).from(debtsTable)
      .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), inArray(debtsTable.status, ["open", "partial"]))),
    db.select({ count: count(), amount: sum(debtsTable.remainingAmount) }).from(debtsTable)
      .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), eq(debtsTable.status, "overdue"))),
    Promise.resolve([{ count: 0 }]),
  ]);

  const confirmedRow = paymentRows.find((r) => r.status === "confirmed");
  const pendingRow = paymentRows.find((r) => r.status === "pending");
  const rejectedRow = paymentRows.find((r) => r.status === "rejected");

  res.json({
    dateFrom, dateTo,
    paymentsConfirmedTotal: Number(confirmedRow?.total ?? 0),
    paymentsConfirmedCount: Number(confirmedRow?.count ?? 0),
    paymentsPendingTotal: Number(pendingRow?.total ?? 0),
    paymentsPendingCount: Number(pendingRow?.count ?? 0),
    paymentsRejectedTotal: Number(rejectedRow?.total ?? 0),
    paymentsRejectedCount: Number(rejectedRow?.count ?? 0),
    paymentsByStatus: paymentRows.map((r) => ({ status: r.status, count: Number(r.count), total: Number(r.total ?? 0) })),
    debtsOpenAmount: Number(debtRows[0]?.amount ?? 0),
    debtsOpenCount: Number(debtRows[0]?.count ?? 0),
    debtsOverdueAmount: Number(overdueDebtRows[0]?.amount ?? 0),
    debtsOverdueCount: Number(overdueDebtRows[0]?.count ?? 0),
  });
});

// ─── AI ───────────────────────────────────────────────────────────────────────

router.get("/ai", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);

  const [runsByTask, runsByProvider, safetyBlocked, approvalRows, usageRows] = await Promise.all([
    db.select({ taskType: aiRunsTable.taskType, count: count() }).from(aiRunsTable)
      .where(and(eq(aiRunsTable.workspaceId, activeWorkspaceId), gte(aiRunsTable.createdAt, dateFrom), lte(aiRunsTable.createdAt, dateTo)))
      .groupBy(aiRunsTable.taskType),
    db.select({ provider: aiRunsTable.provider, count: count() }).from(aiRunsTable)
      .where(and(eq(aiRunsTable.workspaceId, activeWorkspaceId), gte(aiRunsTable.createdAt, dateFrom), lte(aiRunsTable.createdAt, dateTo)))
      .groupBy(aiRunsTable.provider),
    db.select({ count: count() }).from(aiSafetyEventsTable)
      .where(and(eq(aiSafetyEventsTable.workspaceId, activeWorkspaceId), gte(aiSafetyEventsTable.createdAt, dateFrom), lte(aiSafetyEventsTable.createdAt, dateTo))),
    db.select({ status: approvalRequestsTable.status, count: count() }).from(approvalRequestsTable)
      .where(and(eq(approvalRequestsTable.workspaceId, activeWorkspaceId), gte(approvalRequestsTable.createdAt, dateFrom), lte(approvalRequestsTable.createdAt, dateTo)))
      .groupBy(approvalRequestsTable.status),
    db.select({ totalTokens: sum(aiUsageTable.totalTokens), totalRuns: sum(aiUsageTable.totalRuns) }).from(aiUsageTable)
      .where(and(eq(aiUsageTable.workspaceId, activeWorkspaceId), gte(aiUsageTable.date, dateFrom.toISOString().split("T")[0]), lte(aiUsageTable.date, dateTo.toISOString().split("T")[0]))),
  ]);

  res.json({
    dateFrom, dateTo,
    runsByTaskType: runsByTask.map((r) => ({ taskType: r.taskType, count: Number(r.count) })),
    runsByProvider: runsByProvider.map((r) => ({ provider: r.provider, count: Number(r.count) })),
    safetyBlockedCount: Number(safetyBlocked[0]?.count ?? 0),
    approvalsByStatus: approvalRows.map((r) => ({ status: r.status, count: Number(r.count) })),
    totalTokensUsed: Number(usageRows[0]?.totalTokens ?? 0),
    totalAiRuns: Number(usageRows[0]?.totalRuns ?? 0),
  });
});

// ─── Team ─────────────────────────────────────────────────────────────────────

router.get("/team", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);

  const members = await db.select({
    userId: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
  }).from(usersTable)
    .innerJoin(workspaceMembershipsTable, and(
      eq(workspaceMembershipsTable.userId, usersTable.id),
      eq(workspaceMembershipsTable.workspaceId, activeWorkspaceId),
      eq(workspaceMembershipsTable.status, "active"),
    ));

  const teamStats = await Promise.all(
    members.map(async (member) => {
      const [msgsSent, tasksCompleted, followupsDone, ordersCreated, paymentsRecorded] = await Promise.all([
        db.select({ count: count() }).from(messagesTable)
          .where(and(eq(messagesTable.workspaceId, activeWorkspaceId), eq(messagesTable.senderId, member.userId), eq(messagesTable.direction, "outbound"), gte(messagesTable.createdAt, dateFrom), lte(messagesTable.createdAt, dateTo))),
        db.select({ count: count() }).from(tasksTable)
          .where(and(eq(tasksTable.workspaceId, activeWorkspaceId), eq(tasksTable.createdBy, member.userId), eq(tasksTable.status, "completed"), gte(tasksTable.createdAt, dateFrom), lte(tasksTable.createdAt, dateTo))),
        db.select({ count: count() }).from(followupsTable)
          .where(and(eq(followupsTable.workspaceId, activeWorkspaceId), eq(followupsTable.createdBy, member.userId), eq(followupsTable.status, "completed"), gte(followupsTable.createdAt, dateFrom), lte(followupsTable.createdAt, dateTo))),
        db.select({ count: count() }).from(ordersTable)
          .where(and(eq(ordersTable.workspaceId, activeWorkspaceId), eq(ordersTable.createdBy, member.userId), gte(ordersTable.createdAt, dateFrom), lte(ordersTable.createdAt, dateTo))),
        db.select({ count: count() }).from(paymentsTable)
          .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.createdBy, member.userId), gte(paymentsTable.createdAt, dateFrom), lte(paymentsTable.createdAt, dateTo))),
      ]);
      return {
        userId: member.userId,
        name: member.name,
        email: member.email,
        messagesSent: Number(msgsSent[0]?.count ?? 0),
        tasksCompleted: Number(tasksCompleted[0]?.count ?? 0),
        followupsCompleted: Number(followupsDone[0]?.count ?? 0),
        ordersCreated: Number(ordersCreated[0]?.count ?? 0),
        paymentsRecorded: Number(paymentsRecorded[0]?.count ?? 0),
      };
    })
  );

  res.json({ dateFrom, dateTo, teamStats });
});

// ─── Channels ─────────────────────────────────────────────────────────────────

router.get("/channels", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const { dateFrom, dateTo } = parseDateRange(req.query as Record<string, unknown>);

  const [convByChannel, msgBySource] = await Promise.all([
    db.select({ channel: conversationsTable.channel, count: count() }).from(conversationsTable)
      .where(and(eq(conversationsTable.workspaceId, activeWorkspaceId), gte(conversationsTable.createdAt, dateFrom), lte(conversationsTable.createdAt, dateTo)))
      .groupBy(conversationsTable.channel),
    db.select({ direction: messagesTable.direction, count: count() }).from(messagesTable)
      .where(and(eq(messagesTable.workspaceId, activeWorkspaceId), gte(messagesTable.createdAt, dateFrom), lte(messagesTable.createdAt, dateTo)))
      .groupBy(messagesTable.direction),
  ]);

  res.json({
    dateFrom, dateTo,
    conversationsByChannel: convByChannel.map((r) => ({ channel: r.channel, count: Number(r.count) })),
    messagesByDirection: msgBySource.map((r) => ({ direction: r.direction, count: Number(r.count) })),
  });
});

export default router;
