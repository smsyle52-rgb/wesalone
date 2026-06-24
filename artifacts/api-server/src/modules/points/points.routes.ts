import { Router, type Response } from "express";
import { z } from "zod";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";
import { getWalletBalance, getLedgerEntries } from "../../services/point-wallet";
import {
  checkTopupEligibility,
  listActiveTopupProducts,
  createPurchaseOrder,
  submitPaymentProof,
  cancelPurchaseOrder,
  listPurchaseOrders,
} from "../../services/point-topup";

const router = Router();
router.use(requireSession);

// GET /api/points/wallet — ملخص الرصيد (شهري + مشترى + مجمد)
router.get("/wallet", requirePermission("billing:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { activeWorkspaceId } = req.sessionUser;
    const [balance, eligibility] = await Promise.all([
      getWalletBalance(activeWorkspaceId),
      checkTopupEligibility(activeWorkspaceId),
    ]);
    res.json({ balance, canTopup: eligibility.eligible, topupBlockReason: eligibility.reason ?? null });
  } catch (err) {
    logger.error({ err }, "points/wallet: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// GET /api/points/topup-products — حزم الشحن النشطة
router.get("/topup-products", requirePermission("billing:read"), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const products = await listActiveTopupProducts();
    res.json({ products });
  } catch (err) {
    logger.error({ err }, "points/topup-products: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

// GET /api/points/purchase-orders — سجل طلبات الشراء
router.get("/purchase-orders", requirePermission("billing:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const orders = await listPurchaseOrders(req.sessionUser.activeWorkspaceId, limit, offset);
    res.json({ orders });
  } catch (err) {
    logger.error({ err }, "points/purchase-orders GET: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const createOrderSchema = z.object({
  topupProductId: z.string().uuid("معرف الحزمة غير صالح"),
});

// POST /api/points/purchase-orders — إنشاء طلب شراء
router.post("/purchase-orders", requirePermission("billing:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" });
    return;
  }

  try {
    const order = await createPurchaseOrder({
      workspaceId: req.sessionUser.activeWorkspaceId,
      topupProductId: parsed.data.topupProductId,
    });
    res.status(201).json({ order });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "free_plan") {
      res.status(403).json({ error: "شحن النقاط متاح بعد الترقية إلى إحدى الباقات المدفوعة.", code });
      return;
    }
    if (code === "no_subscription" || code === "inactive_subscription") {
      res.status(403).json({ error: "الاشتراك غير فعّال. الرجاء تجديد الباقة.", code });
      return;
    }
    if (code === "product_not_found") {
      res.status(404).json({ error: "الحزمة غير موجودة أو غير متاحة حالياً.", code });
      return;
    }
    if (code === "plan_not_allowed") {
      res.status(403).json({ error: "هذه الحزمة غير متاحة لباقتك الحالية.", code });
      return;
    }
    if (code === "max_pending_reached") {
      res.status(429).json({
        error: "لديك عدد كافٍ من الطلبات المعلقة. أكمل الطلب الحالي أو ألغِه أولاً.",
        code,
      });
      return;
    }
    logger.error({ err }, "points/purchase-orders POST: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

const submitPaymentSchema = z.object({
  paymentMethod: z.enum(["kuraimi", "jawali", "bank_transfer", "cash"]),
  /** المبلغ بالوحدات الصغرى كـstring (لا float). مثال: "70000" = 700.00 دولار أو 70000 ريال */
  paidAmountMinor: z.string().regex(/^\d+$/, "المبلغ يجب أن يكون عدداً صحيحاً بالوحدات الصغرى (لا نقطة عشرية)"),
  /** رمز ISO للعملة: YER | USD | SAR */
  paidCurrency: z.string().length(3, "رمز العملة يجب أن يكون 3 أحرف ISO").toUpperCase(),
  paymentReference: z.string().trim().max(200).optional().nullable(),
  paymentReceiptNote: z.string().trim().max(2000).optional().nullable(),
  receiptFileUrl: z.string().url().optional().nullable(),
});

// POST /api/points/purchase-orders/:id/submit-payment — رفع إثبات الدفع
router.post(
  "/purchase-orders/:id/submit-payment",
  requirePermission("billing:manage"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = submitPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" });
      return;
    }

    try {
      const order = await submitPaymentProof({
        workspaceId: req.sessionUser.activeWorkspaceId,
        orderId: req.params.id as string,
        paymentMethod: parsed.data.paymentMethod,
        paidAmountMinor: parsed.data.paidAmountMinor,
        paidCurrency: parsed.data.paidCurrency,
        paymentReference: parsed.data.paymentReference ?? undefined,
        paymentReceiptNote: parsed.data.paymentReceiptNote ?? undefined,
        receiptFileUrl: parsed.data.receiptFileUrl ?? undefined,
      });
      res.json({ order });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "not_found") { res.status(404).json({ error: "الطلب غير موجود" }); return; }
      if (code === "invalid_status") {
        res.status(422).json({ error: "لا يمكن رفع إثبات الدفع في الحالة الحالية للطلب" });
        return;
      }
      logger.error({ err }, "points/submit-payment: failed");
      res.status(500).json({ error: "حدث خطأ داخلي" });
    }
  },
);

// POST /api/points/purchase-orders/:id/cancel — إلغاء طلب معلق
router.post(
  "/purchase-orders/:id/cancel",
  requirePermission("billing:manage"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const order = await cancelPurchaseOrder({
        workspaceId: req.sessionUser.activeWorkspaceId,
        orderId: req.params.id as string,
      });
      res.json({ order });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "not_found") { res.status(404).json({ error: "الطلب غير موجود" }); return; }
      if (code === "cannot_cancel") {
        res.status(422).json({ error: "لا يمكن إلغاء الطلب في حالته الحالية" });
        return;
      }
      logger.error({ err }, "points/cancel: failed");
      res.status(500).json({ error: "حدث خطأ داخلي" });
    }
  },
);

// GET /api/points/ledger — سجل الحركات (microPoints كـstring لأمان BigInt)
router.get("/ledger", requirePermission("billing:read"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const entries = await getLedgerEntries(req.sessionUser.activeWorkspaceId, limit, offset);
    const serialized = entries.map((e) => ({ ...e, microPoints: e.microPoints.toString() }));
    res.json({ entries: serialized });
  } catch (err) {
    logger.error({ err }, "points/ledger: failed");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
