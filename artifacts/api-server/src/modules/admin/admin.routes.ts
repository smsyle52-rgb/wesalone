import { Router, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  domainEventsTable,
  paymentSubmissionsTable,
  plansTable,
  subscriptionsTable,
  workspacesTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import type { AuthenticatedRequest } from "../../lib/types";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import { notifyWorkspace } from "../../services/notifications";

const router = Router();
router.use(requireSession);

function requireOwner(req: AuthenticatedRequest, res: Response): boolean {
  if (req.sessionUser.roleSlugs.includes("owner")) return true;
  res.status(403).json({ error: "هذه الصفحة متاحة للمالك فقط" });
  return false;
}

router.get("/payments", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requireOwner(req, res)) return;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = status && status !== "all"
    ? and(eq(paymentSubmissionsTable.status, status), eq(paymentSubmissionsTable.workspaceId, req.sessionUser.activeWorkspaceId))
    : eq(paymentSubmissionsTable.workspaceId, req.sessionUser.activeWorkspaceId);

  const submissions = await db
    .select({
      id: paymentSubmissionsTable.id,
      amountYer: paymentSubmissionsTable.amountYer,
      paymentMethod: paymentSubmissionsTable.paymentMethod,
      reference: paymentSubmissionsTable.reference,
      receiptNote: paymentSubmissionsTable.receiptNote,
      status: paymentSubmissionsTable.status,
      reviewedAt: paymentSubmissionsTable.reviewedAt,
      createdAt: paymentSubmissionsTable.createdAt,
      workspaceId: paymentSubmissionsTable.workspaceId,
      workspaceName: workspacesTable.name,
      planId: paymentSubmissionsTable.planId,
      planName: plansTable.name,
      planNameAr: plansTable.nameAr,
    })
    .from(paymentSubmissionsTable)
    .innerJoin(workspacesTable, eq(paymentSubmissionsTable.workspaceId, workspacesTable.id))
    .innerJoin(plansTable, eq(paymentSubmissionsTable.planId, plansTable.id))
    .where(where)
    .orderBy(desc(paymentSubmissionsTable.createdAt))
    .limit(100);

  res.json({ submissions });
});

const rejectSchema = z.object({ reason: z.string().trim().min(2).max(500).optional() });

router.post("/payments/:id/confirm", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requireOwner(req, res)) return;
  const submissionId = String(req.params.id);
  const [submission] = await db
    .select()
    .from(paymentSubmissionsTable)
    .where(and(
      eq(paymentSubmissionsTable.id, submissionId),
      eq(paymentSubmissionsTable.workspaceId, req.sessionUser.activeWorkspaceId),
    ))
    .limit(1);
  if (!submission) {
    res.status(404).json({ error: "طلب الدفع غير موجود" });
    return;
  }

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const periodEndDate = periodEnd.toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    await tx.update(paymentSubmissionsTable)
      .set({ status: "confirmed", reviewedBy: req.sessionUser.userId, reviewedAt: new Date() })
      .where(eq(paymentSubmissionsTable.id, submission.id));

    await tx.insert(subscriptionsTable).values({
      workspaceId: submission.workspaceId,
      planId: submission.planId,
      status: "active",
      startedAt: new Date(),
      currentPeriodStart: new Date().toISOString().slice(0, 10),
      currentPeriodEnd: periodEndDate,
      paymentMethod: submission.paymentMethod,
      lastPaymentRef: submission.reference ?? null,
    }).onConflictDoUpdate({
      target: subscriptionsTable.workspaceId,
      set: {
        planId: submission.planId,
        status: "active",
        currentPeriodStart: new Date().toISOString().slice(0, 10),
        currentPeriodEnd: periodEndDate,
        paymentMethod: submission.paymentMethod,
        lastPaymentRef: submission.reference ?? null,
        updatedAt: new Date(),
      },
    });

    await tx.insert(domainEventsTable).values({
      workspaceId: submission.workspaceId,
      eventType: "billing.payment.confirmed",
      entityType: "payment_submission",
      entityId: submission.id,
      payload: { planId: submission.planId, amountYer: submission.amountYer, currentPeriodEnd: periodEndDate },
    });
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "payment_submission",
    entityId: submission.id,
    newData: { status: "confirmed", currentPeriodEnd: periodEndDate },
  });

  await notifyWorkspace({
    workspaceId: submission.workspaceId,
    type: "billing.payment.confirmed",
    titleAr: "تم تأكيد الدفع",
    bodyAr: "تمت مراجعة دفعتك وتفعيل الباقة بنجاح.",
    link: "/settings?tab=billing",
  });

  res.json({ ok: true, currentPeriodEnd: periodEndDate });
});

router.post("/payments/:id/reject", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requireOwner(req, res)) return;
  const submissionId = String(req.params.id);
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "سبب الرفض غير صالح", details: parsed.error.flatten() });
    return;
  }

  const [submission] = await db.update(paymentSubmissionsTable)
    .set({ status: "rejected", reviewedBy: req.sessionUser.userId, reviewedAt: new Date(), receiptNote: parsed.data.reason ?? null })
    .where(and(eq(paymentSubmissionsTable.id, submissionId), eq(paymentSubmissionsTable.workspaceId, req.sessionUser.activeWorkspaceId)))
    .returning();
  if (!submission) {
    res.status(404).json({ error: "طلب الدفع غير موجود" });
    return;
  }

  await db.insert(domainEventsTable).values({
    workspaceId: submission.workspaceId,
    eventType: "billing.payment.rejected",
    entityType: "payment_submission",
    entityId: submission.id,
    payload: { reason: parsed.data.reason ?? null },
  });

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "warning",
    entityType: "payment_submission",
    entityId: submission.id,
    newData: { status: "rejected", reason: parsed.data.reason ?? null },
  });

  await notifyWorkspace({
    workspaceId: submission.workspaceId,
    type: "billing.payment.rejected",
    titleAr: "تم رفض طلب الدفع",
    bodyAr: parsed.data.reason
      ? `تم رفض طلب الدفع. السبب: ${parsed.data.reason}`
      : "تم رفض طلب الدفع. راجع تفاصيل الفوترة أو تواصل مع الدعم.",
    link: "/settings?tab=billing",
  });

  res.json({ ok: true });
});

export default router;
