import { Router, type Request, type Response } from "express";
import { eq, desc, and, gte, lte, ilike, or, count } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();

router.use(requireSession);
router.use(requirePermission("audit_logs:read"));

router.get("/", async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const {
    entity_type,
    action,
    severity,
    actor_id,
    date_from,
    date_to,
    search,
    page = "1",
    page_size = "20",
  } = req.query as Record<string, string>;

  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedPageSize = Math.min(100, Math.max(1, Number(page_size) || 20));
  const offset = (parsedPage - 1) * parsedPageSize;

  try {
    const conditions = [
      eq(auditLogsTable.workspaceId, authReq.sessionUser.activeWorkspaceId),
    ];

    if (entity_type) conditions.push(eq(auditLogsTable.entityType, entity_type));
    if (action) conditions.push(eq(auditLogsTable.action, action));
    if (severity) conditions.push(eq(auditLogsTable.severity, severity));
    if (actor_id) conditions.push(eq(auditLogsTable.actorId, actor_id as string));
    if (date_from) conditions.push(gte(auditLogsTable.createdAt, new Date(date_from)));
    if (date_to) {
      const to = new Date(date_to);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogsTable.createdAt, to));
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(auditLogsTable.actorLabel, term),
          ilike(auditLogsTable.entityLabel, term)
        ) as ReturnType<typeof eq>
      );
    }

    const whereClause = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(auditLogsTable)
      .where(whereClause);

    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(whereClause)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(parsedPageSize)
      .offset(offset);

    const canSeeChangeData = authReq.sessionUser.roleSlugs.some(
      (r) => r === "owner" || r === "manager"
    );

    const logs = rows.map((log) => ({
      id: log.id,
      workspaceId: log.workspaceId,
      actorType: log.actorType,
      actorId: log.actorId,
      actorLabel: log.actorLabel,
      action: log.action,
      severity: log.severity,
      entityType: log.entityType,
      entityId: log.entityId,
      entityLabel: log.entityLabel,
      requestId: log.requestId,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt,
      ...(canSeeChangeData
        ? { oldData: log.oldData, newData: log.newData }
        : {}),
    }));

    res.json({ logs, total: Number(total), page: parsedPage, pageSize: parsedPageSize });
  } catch (err) {
    logger.error({ err }, "Failed to list audit logs");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
