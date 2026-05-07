import { Router, type Response } from "express";
import { eq, and, count, sum, gte, inArray } from "drizzle-orm";
import {
  db,
  conversationsTable, ticketsTable, tasksTable, followupsTable,
  ordersTable, paymentsTable, contactsTable, opportunitiesTable,
  auditLogsTable, debtsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

router.get("/summary", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    [{ openConversations }],
    [{ openTickets }],
    [{ pendingTasks }],
    [{ pendingFollowups }],
    [{ ordersToday }],
    [{ openOrders }],
    [{ revenueToday }],
    [{ pendingPaymentsCount }],
    [{ pendingPaymentsAmount }],
    [{ totalContacts }],
    [{ pipelineValue }],
    [{ openDebtsCount }],
    [{ openDebtsAmount }],
    [{ overdueDebtsCount }],
    [{ overdueDebtsAmount }],
  ] = await Promise.all([
    db.select({ openConversations: count() }).from(conversationsTable)
      .where(and(eq(conversationsTable.workspaceId, activeWorkspaceId), eq(conversationsTable.status, "open"))),
    db.select({ openTickets: count() }).from(ticketsTable)
      .where(and(eq(ticketsTable.workspaceId, activeWorkspaceId), eq(ticketsTable.status, "open"))),
    db.select({ pendingTasks: count() }).from(tasksTable)
      .where(and(eq(tasksTable.workspaceId, activeWorkspaceId), eq(tasksTable.status, "pending"))),
    db.select({ pendingFollowups: count() }).from(followupsTable)
      .where(and(eq(followupsTable.workspaceId, activeWorkspaceId), eq(followupsTable.status, "pending"))),
    db.select({ ordersToday: count() }).from(ordersTable)
      .where(and(eq(ordersTable.workspaceId, activeWorkspaceId), gte(ordersTable.createdAt, todayStart))),
    db.select({ openOrders: count() }).from(ordersTable)
      .where(and(eq(ordersTable.workspaceId, activeWorkspaceId), inArray(ordersTable.status, ["new", "confirmed", "processing", "ready"]))),
    db.select({ revenueToday: sum(ordersTable.totalAmount) }).from(ordersTable)
      .where(and(eq(ordersTable.workspaceId, activeWorkspaceId), gte(ordersTable.createdAt, todayStart), eq(ordersTable.status, "delivered"))),
    db.select({ pendingPaymentsCount: count() }).from(paymentsTable)
      .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.status, "pending"))),
    db.select({ pendingPaymentsAmount: sum(paymentsTable.amount) }).from(paymentsTable)
      .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.status, "pending"))),
    db.select({ totalContacts: count() }).from(contactsTable)
      .where(eq(contactsTable.workspaceId, activeWorkspaceId)),
    db.select({ pipelineValue: sum(opportunitiesTable.value) }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId))),
    db.select({ openDebtsCount: count() }).from(debtsTable)
      .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), inArray(debtsTable.status, ["open", "partial"]))),
    db.select({ openDebtsAmount: sum(debtsTable.remainingAmount) }).from(debtsTable)
      .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), inArray(debtsTable.status, ["open", "partial"]))),
    db.select({ overdueDebtsCount: count() }).from(debtsTable)
      .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), eq(debtsTable.status, "overdue"))),
    db.select({ overdueDebtsAmount: sum(debtsTable.remainingAmount) }).from(debtsTable)
      .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), eq(debtsTable.status, "overdue"))),
  ]);

  res.json({
    openConversations: Number(openConversations),
    openTickets: Number(openTickets),
    pendingTasks: Number(pendingTasks),
    pendingFollowups: Number(pendingFollowups),
    ordersToday: Number(ordersToday),
    openOrders: Number(openOrders),
    revenueToday: Number(revenueToday ?? 0),
    pendingPayments: Number(pendingPaymentsCount),
    pendingPaymentsAmount: Number(pendingPaymentsAmount ?? 0),
    totalContacts: Number(totalContacts),
    pipelineValue: Number(pipelineValue ?? 0),
    openDebtsCount: Number(openDebtsCount),
    openDebtsAmount: Number(openDebtsAmount ?? 0),
    overdueDebtsCount: Number(overdueDebtsCount),
    overdueDebtsAmount: Number(overdueDebtsAmount ?? 0),
  });
});

router.get("/activity", requirePermission("analytics:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

  const activities = await db.select({
    id: auditLogsTable.id,
    action: auditLogsTable.action,
    entityType: auditLogsTable.entityType,
    entityId: auditLogsTable.entityId,
    entityLabel: auditLogsTable.entityLabel,
    actorLabel: auditLogsTable.actorLabel,
    occurredAt: auditLogsTable.createdAt,
  })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.workspaceId, activeWorkspaceId))
    .orderBy(auditLogsTable.createdAt)
    .limit(limit);

  const mapped = activities.map((a) => ({
    id: a.id,
    type: a.entityType as string,
    action: a.action,
    entityId: a.entityId ?? "",
    entityLabel: a.entityLabel ?? "",
    actorName: a.actorLabel ?? "",
    occurredAt: a.occurredAt,
  }));

  res.json({ activities: mapped.reverse(), total: mapped.length });
});

export default router;
