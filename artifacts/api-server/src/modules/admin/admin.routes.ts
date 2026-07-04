import { Router, type Response } from "express";
import { z } from "zod";
import { desc, eq, gt } from "drizzle-orm";
import {
  db,
  pointTopupProductsTable,
  usersTable,
  workspaceMembershipsTable,
  workspacesTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePlatformAdmin } from "../../middlewares/requirePlatformAdmin";
import type { AuthenticatedRequest } from "../../lib/types";
import { auditFromRequest, createAuditLog } from "../../lib/audit";
import { notifyWorkspace } from "../../services/notifications";
import { getWorkspaceOnboardingStatus } from "../../services/onboarding-status";
import {
  approvePurchaseOrder,
  rejectPurchaseOrder,
  listAllOrdersAdmin,
  listTopupProductsAdmin,
  processRefund,
  getRefundInfo,
  type RefundType,
} from "../../services/point-topup";
import {
  adminAdjustPoints,
  getLedgerEntries,
} from "../../services/point-wallet";
import {
  confirmSubscriptionPayment,
  getSubscriptionPaymentStats,
  listSubscriptionPaymentsAdmin,
  rejectSubscriptionPayment,
} from "../../services/subscription-payments";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";

const router = Router();
router.use(requireSession);

const paymentStatusSchema = z.enum(["under_review", "confirmed", "rejected", "cancelled", "expired", "all"]);
const rejectSchema = z.object({ reason: z.string().trim().min(2).max(500) });

// GET /admin/signups — رؤية سريعة لكل تسجيل جديد وأين توقّف فعلياً (وكيل/قناة/تحقّق بريد)
// بدل تكرار فحص SQL يدوي لكل عميل جديد.
router.get("/signups", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const days = Math.min(60, Math.max(1, parseInt(req.query.days as string, 10) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        workspaceId: workspacesTable.id,
        workspaceName: workspacesTable.name,
        registeredAt: workspacesTable.createdAt,
        userId: usersTable.id,
        email: usersTable.email,
        emailVerified: usersTable.emailVerified,
      })
      .from(workspacesTable)
      .innerJoin(workspaceMembershipsTable, eq(workspaceMembershipsTable.workspaceId, workspacesTable.id))
      .innerJoin(usersTable, eq(usersTable.id, workspaceMembershipsTable.userId))
      .where(gt(workspacesTable.createdAt, since))
      .orderBy(desc(workspacesTable.createdAt))
      .limit(200);

    const signups = await Promise.all(rows.map(async (row) => {
      const status = await getWorkspaceOnboardingStatus(row.workspaceId);
      return {
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        email: row.email,
        emailVerified: row.emailVerified,
        registeredAt: row.registeredAt,
        onboardingCompleted: status.completed,
        agentDone: status.steps.agent.completed,
        channelDone: status.steps.channel.completed,
        stuckAt: status.completed
          ? null
          : !row.emailVerified
          ? "email_verification"
          : !status.steps.agent.completed
          ? "agent"
          : "channel",
      };
    }));

    res.json({ signups, days });
  } catch (err) {
    logger.error({ err }, "admin/signups GET: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/payments", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const parsedStatus = paymentStatusSchema.safeParse(typeof req.query.status === "string" ? req.query.status : "under_review");
    const status = parsedStatus.success ? parsedStatus.data : "under_review";
    const [submissions, stats] = await Promise.all([
      listSubscriptionPaymentsAdmin(status),
      getSubscriptionPaymentStats(),
    ]);
    res.json({ submissions, stats });
  } catch (err) {
    logger.error({ err }, "admin/payments GET: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.post("/payments/:id/confirm", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const submissionId = String(req.params.id);
  try {
    const result = await confirmSubscriptionPayment({ submissionId, reviewedByUserId: req.sessionUser.userId });
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "critical",
      entityType: "payment_submission",
      entityId: submissionId,
      newData: { status: "confirmed", currentPeriodStart: result.currentPeriodStart, currentPeriodEnd: result.currentPeriodEnd, points: result.points },
    });
    await notifyWorkspace({
      workspaceId: result.submission.workspaceId,
      type: "billing.payment.confirmed",
      titleAr: "تم تأكيد الدفع",
      bodyAr: "تمت مراجعة دفعتك وتفعيل الباقة وإضافة نقاط الذكاء بنجاح.",
      link: "/settings?tab=billing",
    });
    res.json({ ok: true, currentPeriodStart: result.currentPeriodStart, currentPeriodEnd: result.currentPeriodEnd, points: result.points });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") { res.status(404).json({ error: "طلب الدفع غير موجود", code }); return; }
    if (code === "not_subscription") { res.status(422).json({ error: "هذا الطلب ليس طلب اشتراك", code }); return; }
    if (code === "not_under_review") { res.status(422).json({ error: "لا يمكن تأكيد طلب ليس قيد المراجعة", code }); return; }
    if (code === "concurrent_update") { res.status(409).json({ error: "تمت معالجة الطلب مسبقا", code }); return; }
    if (code === "plan_not_found") { res.status(422).json({ error: "الباقة غير موجودة", code }); return; }
    logger.error({ err, submissionId }, "admin/payments confirm: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.post("/payments/:id/reject", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const submissionId = String(req.params.id);
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "سبب الرفض إلزامي ويجب أن يكون واضحا", details: parsed.error.flatten() });
    return;
  }
  try {
    const submission = await rejectSubscriptionPayment({ submissionId, reviewedByUserId: req.sessionUser.userId, reason: parsed.data.reason });
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "warning",
      entityType: "payment_submission",
      entityId: submission.id,
      newData: { status: "rejected", reason: parsed.data.reason },
    });
    await notifyWorkspace({
      workspaceId: submission.workspaceId,
      type: "billing.payment.rejected",
      titleAr: "تم رفض طلب الدفع",
      bodyAr: `تم رفض طلب الدفع. السبب: ${parsed.data.reason}`,
      link: "/settings?tab=billing",
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") { res.status(404).json({ error: "طلب الدفع غير موجود", code }); return; }
    if (code === "not_subscription") { res.status(422).json({ error: "هذا الطلب ليس طلب اشتراك", code }); return; }
    if (code === "confirmed_not_rejectable") { res.status(422).json({ error: "لا يمكن رفض طلب مؤكد", code }); return; }
    if (code === "not_reviewable") { res.status(422).json({ error: "لا يمكن رفض الطلب في حالته الحالية", code }); return; }
    if (code === "concurrent_update") { res.status(409).json({ error: "تمت معالجة الطلب مسبقا", code }); return; }
    logger.error({ err, submissionId }, "admin/payments reject: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// ── إدارة طلبات شحن النقاط ───────────────────────────────────────────────────

// GET /admin/points/purchase-orders?status=under_review
router.get("/points/purchase-orders", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const orders = await listAllOrdersAdmin(status, limit, offset);
    res.json({ orders });
  } catch (err) {
    logger.error({ err }, "admin/points/purchase-orders GET: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// POST /admin/points/purchase-orders/:id/approve
router.post("/points/purchase-orders/:id/approve", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const orderId = String(req.params.id);
  try {
    const order = await approvePurchaseOrder({
      orderId,
      approvedByUserId: req.sessionUser.userId,
    });

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "critical",
      entityType: "point_purchase_order",
      entityId: orderId,
      newData: { status: "approved", creditedGrantId: order.creditedGrantId, points: order.pointsSnapshot },
    });

    await notifyWorkspace({
      workspaceId: order.workspaceId,
      type: "billing.topup.approved",
      titleAr: "تمت إضافة النقاط",
      bodyAr: `تمت مراجعة طلب الشحن وإضافة ${order.pointsSnapshot.toLocaleString("ar")} نقطة إلى رصيدك.`,
      link: "/settings?tab=billing",
    });

    res.json({ ok: true, order });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") { res.status(404).json({ error: "الطلب غير موجود" }); return; }
    if (code === "not_under_review") { res.status(422).json({ error: "الطلب ليس في حالة مراجعة", code }); return; }
    if (code === "already_credited") { res.status(409).json({ error: "الطلب مُعتمد ومُرصَد مسبقاً" }); return; }
    logger.error({ err, orderId }, "admin/points/approve: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// POST /admin/points/purchase-orders/:id/reject
const rejectOrderSchema = z.object({ reason: z.string().trim().min(2).max(500) });

router.post("/points/purchase-orders/:id/reject", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const parsed = rejectOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "يجب إدخال سبب الرفض (2 أحرف على الأقل)" });
    return;
  }
  const orderId = String(req.params.id);
  try {
    const order = await rejectPurchaseOrder({
      orderId,
      rejectedByUserId: req.sessionUser.userId,
      reason: parsed.data.reason,
    });

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "warning",
      entityType: "point_purchase_order",
      entityId: orderId,
      newData: { status: "rejected", reason: parsed.data.reason },
    });

    await notifyWorkspace({
      workspaceId: order.workspaceId,
      type: "billing.topup.rejected",
      titleAr: "تم رفض طلب الشحن",
      bodyAr: `تم رفض طلب شحن النقاط. السبب: ${parsed.data.reason}`,
      link: "/settings?tab=billing",
    });

    res.json({ ok: true, order });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") { res.status(404).json({ error: "الطلب غير موجود" }); return; }
    if (code === "not_reviewable") { res.status(422).json({ error: "لا يمكن رفض الطلب في حالته الحالية", code }); return; }
    logger.error({ err, orderId }, "admin/points/reject: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// GET /admin/points/purchase-orders/:id/refund-info — معلومات الاسترداد للإدارة
router.get("/points/purchase-orders/:id/refund-info", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const orderId = String(req.params.id);
  try {
    const info = await getRefundInfo(orderId);
    res.json(info);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") { res.status(404).json({ error: "الطلب غير موجود" }); return; }
    if (code === "not_approved") { res.status(422).json({ error: "الطلب ليس معتمداً", code }); return; }
    logger.error({ err, orderId }, "admin/points/refund-info: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// POST /admin/points/purchase-orders/:id/refund — استرداد ذري idempotent
// refundType: full_refund | partial_refund | points_reversal | chargeback
const refundOrderSchema = z.object({
  refundType: z.enum(["full_refund", "partial_refund", "points_reversal", "chargeback"]),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().min(4).max(200),
  // مطلوبان فقط لـpartial_refund
  partialRefundAmountMinor: z.string().regex(/^\d+$/).optional(),
  partialRefundCurrency: z.string().length(3).optional(),
});

router.post("/points/purchase-orders/:id/refund", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const parsed = refundOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" });
    return;
  }
  const orderId = String(req.params.id);
  try {
    const result = await processRefund({
      orderId,
      refundType: parsed.data.refundType as RefundType,
      reason: parsed.data.reason,
      actorId: req.sessionUser.userId,
      idempotencyKey: parsed.data.idempotencyKey,
      partialRefundAmountMinor: parsed.data.partialRefundAmountMinor,
      partialRefundCurrency: parsed.data.partialRefundCurrency,
    });

    if (!result.wasAlreadyRefunded) {
      await createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "update",
        severity: "critical",
        entityType: "point_purchase_order",
        entityId: orderId,
        newData: {
          refundType: parsed.data.refundType,
          reason: parsed.data.reason,
          microPointsReversed: result.microPointsReversedStr,
          refundedAmountMinor: result.refundedAmountMinor,
        },
      });
    }

    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") { res.status(404).json({ error: "الطلب غير موجود" }); return; }
    if (code === "not_approved") { res.status(422).json({ error: "الطلب ليس معتمداً — الاسترداد يتطلب موافقة مسبقة", code }); return; }
    if (code === "points_partially_used") {
      res.status(422).json({
        error: "لا يمكن الاسترداد الكامل — جزء من النقاط مستخدم",
        code,
        refundInfo: (err as { refundInfo?: unknown }).refundInfo,
      });
      return;
    }
    if (code === "partial_amount_required") {
      res.status(400).json({ error: "الاسترداد الجزئي يتطلب partialRefundAmountMinor و partialRefundCurrency" });
      return;
    }
    logger.error({ err, orderId }, "admin/points/refund: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// POST /admin/points/adjustment — تعديل إداري بسبب إلزامي
const adjustmentSchema = z.object({
  workspaceId: z.string().uuid(),
  // موجب فقط — الخصم معطّل حتى Phase 3 (منطق debit-from-grants)
  points: z.number().int().positive({ message: "التعديل الإداري موجب فقط. الخصم متاح في مرحلة لاحقة." }),
  reason: z.string().trim().min(5).max(500),
});

router.post("/points/adjustment", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" });
    return;
  }

  try {
    const idempotencyKey = `admin_adj:${req.sessionUser.userId}:${parsed.data.workspaceId}:${randomUUID()}`;
    await adminAdjustPoints({
      workspaceId: parsed.data.workspaceId,
      points: parsed.data.points,
      reason: parsed.data.reason,
      actorId: req.sessionUser.userId,
      idempotencyKey,
    });

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "critical",
      entityType: "point_wallet",
      entityId: parsed.data.workspaceId,
      newData: { points: parsed.data.points, reason: parsed.data.reason },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "admin/points/adjustment: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// GET /admin/points/ledger/:workspaceId — ledger لمساحة عمل
router.get("/points/ledger/:workspaceId", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const entries = await getLedgerEntries(req.params.workspaceId as string, limit, offset);
    const serialized = entries.map((e) => ({ ...e, microPoints: e.microPoints.toString() }));
    res.json({ entries: serialized });
  } catch (err) {
    logger.error({ err }, "admin/points/ledger: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// ── إدارة حزم الشحن ──────────────────────────────────────────────────────────

// GET /admin/points/topup-products
router.get("/points/topup-products", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const products = await listTopupProductsAdmin();
    res.json({ products });
  } catch (err) {
    logger.error({ err }, "admin/points/topup-products GET: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const topupProductSchema = z.object({
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/, "slug: أحرف صغيرة وأرقام وشرطة سفلية فقط"),
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(80),
  descriptionAr: z.string().trim().max(300).optional().nullable(),
  descriptionEn: z.string().trim().max(300).optional().nullable(),
  points: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(100),
  allowedPlanSlugs: z.array(z.string()).default([]),
  effectiveFrom: z.string().datetime().optional().nullable(),
  effectiveUntil: z.string().datetime().optional().nullable(),
});

// POST /admin/points/topup-products
router.post("/points/topup-products", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const parsed = topupProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" });
    return;
  }
  try {
    const [product] = await db
      .insert(pointTopupProductsTable)
      .values({
        ...parsed.data,
        effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
        effectiveUntil: parsed.data.effectiveUntil ? new Date(parsed.data.effectiveUntil) : null,
      })
      .returning();
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "point_topup_product",
      entityId: product.id,
      newData: { slug: product.slug, points: product.points, priceCents: product.priceCents },
    });
    res.status(201).json({ product });
  } catch (err) {
    logger.error({ err }, "admin/points/topup-products POST: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// PATCH /admin/points/topup-products/:id
router.patch("/points/topup-products/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const parsed = topupProductSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" });
    return;
  }

  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.effectiveFrom !== undefined) {
    updates.effectiveFrom = parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null;
  }
  if (parsed.data.effectiveUntil !== undefined) {
    updates.effectiveUntil = parsed.data.effectiveUntil ? new Date(parsed.data.effectiveUntil) : null;
  }

  try {
    const [product] = await db
      .update(pointTopupProductsTable)
      .set(updates)
      .where(eq(pointTopupProductsTable.id, req.params.id as string))
      .returning();
    if (!product) { res.status(404).json({ error: "الحزمة غير موجودة" }); return; }
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "warning",
      entityType: "point_topup_product",
      entityId: product.id,
      newData: updates,
    });
    res.json({ product });
  } catch (err) {
    logger.error({ err }, "admin/points/topup-products PATCH: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
