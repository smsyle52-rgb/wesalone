import { Router, type Response } from "express";
import { z } from "zod";
import { db, approvalRequestsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { createAuditLog, auditFromRequest } from "../../lib/audit";

const router = Router();
router.use(requireSession);

router.get("/", requirePermission("approvals:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = req.query.status ? String(req.query.status) : undefined;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20")));
  const offset = (page - 1) * limit;

  const conditions = [eq(approvalRequestsTable.workspaceId, activeWorkspaceId)];
  if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
    conditions.push(eq(approvalRequestsTable.status, status));
  }

  const approvals = await db
    .select()
    .from(approvalRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(approvalRequestsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ approvals });
});

router.get("/:id", requirePermission("approvals:read"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const [approval] = await db.select().from(approvalRequestsTable).where(
    and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.workspaceId, activeWorkspaceId))
  );
  if (!approval) { res.status(404).json({ error: "طلب الاعتماد غير موجود" }); return; }
  res.json({ approval });
});

router.post("/:id/approve", requirePermission("approvals:approve"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const id = String(req.params.id);

  const [approval] = await db.select().from(approvalRequestsTable).where(
    and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.workspaceId, activeWorkspaceId))
  );
  if (!approval) { res.status(404).json({ error: "طلب الاعتماد غير موجود" }); return; }
  if (approval.status !== "pending") {
    res.status(400).json({ error: `لا يمكن اعتماد طلب بحالة: ${approval.status}` });
    return;
  }

  const [updated] = await db.update(approvalRequestsTable).set({
    status: "approved",
    approvedBy: userId,
    resolvedAt: new Date(),
  }).where(eq(approvalRequestsTable.id, id)).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_approval_approved",
    severity: "info",
    entityType: "approval_request",
    entityId: id,
    entityLabel: approval.actionType,
    oldData: { status: "pending" },
    newData: { status: "approved", approvedBy: userId },
  });

  res.json({
    approval: updated,
    note: "تم اعتماد الطلب. يمكنك تنفيذ الإجراء يدوياً الآن.",
    actionType: approval.actionType,
    payload: approval.payload,
  });
});

router.post("/:id/reject", requirePermission("approvals:reject"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const id = String(req.params.id);

  const parse = z.object({
    reason: z.string().trim().min(1, "يجب إدخال سبب رفض الاعتماد").max(1000),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.errors[0]?.message ?? "بيانات غير صالحة" }); return; }

  const [approval] = await db.select().from(approvalRequestsTable).where(
    and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.workspaceId, activeWorkspaceId))
  );
  if (!approval) { res.status(404).json({ error: "طلب الاعتماد غير موجود" }); return; }
  if (approval.status !== "pending") {
    res.status(400).json({ error: `لا يمكن رفض طلب بحالة: ${approval.status}` });
    return;
  }

  const [updated] = await db.update(approvalRequestsTable).set({
    status: "rejected",
    rejectedBy: userId,
    reason: parse.data.reason ?? null,
    resolvedAt: new Date(),
  }).where(eq(approvalRequestsTable.id, id)).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "ai_approval_rejected",
    severity: "warning",
    entityType: "approval_request",
    entityId: id,
    entityLabel: approval.actionType,
    oldData: { status: "pending" },
    newData: { status: "rejected", rejectedBy: userId, reason: parse.data.reason },
  });

  res.json({ approval: updated });
});

router.post("/:id/cancel", requirePermission("approvals:reject"), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);

  const [approval] = await db.select().from(approvalRequestsTable).where(
    and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.workspaceId, activeWorkspaceId))
  );
  if (!approval) { res.status(404).json({ error: "طلب الاعتماد غير موجود" }); return; }
  if (approval.status !== "pending") {
    res.status(400).json({ error: `لا يمكن إلغاء طلب بحالة: ${approval.status}` });
    return;
  }

  const [updated] = await db.update(approvalRequestsTable).set({
    status: "cancelled",
    resolvedAt: new Date(),
  }).where(eq(approvalRequestsTable.id, id)).returning();

  res.json({ approval: updated });
});

export default router;
