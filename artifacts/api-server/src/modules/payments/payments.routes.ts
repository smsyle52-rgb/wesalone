import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, sum, gte, lte } from "drizzle-orm";
import {
  db, paymentsTable, contactsTable, paymentMethodsTable,
  exchangeRatesTable, ordersTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";
import { paymentActionLimiter } from "../../lib/rateLimiter";

const router = Router();
router.use(requireSession);

const createSchema = z.object({
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
  paymentMethodId: z.string().uuid("معرف طريقة الدفع غير صحيح").optional(),
  method: z.enum(["cash", "transfer", "kuraimi", "jawali", "bank", "other"]).optional(),
  contactId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  paidAt: z.string().optional(),
}).refine((d) => d.paymentMethodId || d.method, {
  message: "يجب تحديد طريقة الدفع",
});

const updateSchema = z.object({
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  paidAt: z.string().optional().nullable(),
  paymentMethodId: z.string().uuid("معرف طريقة الدفع غير صحيح").optional().nullable(),
});

const rejectSchema = z.object({
  reason: z.string().min(1, "يجب إدخال سبب رفض الدفعة"),
});

function computePaymentStatus(
  totalAmount: string | null,
  paidAmount: string | null,
): "unpaid" | "partial" | "paid" {
  const total = Number(totalAmount ?? 0);
  const paid = Number(paidAmount ?? 0);
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

router.get("/", requirePermission("payments:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = req.query.status as string | undefined;
  const method = req.query.method as string | undefined;
  const currency = req.query.currency as string | undefined;
  const contactId = req.query.contactId as string | undefined;
  const orderId = req.query.orderId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [eq(paymentsTable.workspaceId, activeWorkspaceId)];
  if (status) conditions.push(eq(paymentsTable.status, status));
  if (method) conditions.push(eq(paymentsTable.method, method));
  if (currency) conditions.push(eq(paymentsTable.currency, currency));
  if (contactId) conditions.push(eq(paymentsTable.contactId, contactId));
  if (orderId) conditions.push(eq(paymentsTable.orderId, orderId));
  if (dateFrom) conditions.push(gte(paymentsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(paymentsTable.createdAt, new Date(dateTo)));

  const [payments, [{ total }], [{ totalConfirmed }], [{ totalPending }]] = await Promise.all([
    db.select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
      currency: paymentsTable.currency,
      method: paymentsTable.method,
      methodSnapshot: paymentsTable.methodSnapshot,
      status: paymentsTable.status,
      reference: paymentsTable.reference,
      notes: paymentsTable.notes,
      paidAt: paymentsTable.paidAt,
      confirmedAt: paymentsTable.confirmedAt,
      rejectedAt: paymentsTable.rejectedAt,
      rejectionReason: paymentsTable.rejectionReason,
      createdAt: paymentsTable.createdAt,
      baseAmountYer: paymentsTable.baseAmountYer,
      exchangeRateSnapshot: paymentsTable.exchangeRateSnapshot,
      contactId: paymentsTable.contactId,
      orderId: paymentsTable.orderId,
      contactName: contactsTable.name,
      orderNumber: ordersTable.orderNumber,
    })
      .from(paymentsTable)
      .leftJoin(contactsTable, eq(paymentsTable.contactId, contactsTable.id))
      .leftJoin(ordersTable, eq(paymentsTable.orderId, ordersTable.id))
      .where(and(...conditions))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(paymentsTable).where(and(...conditions)),
    db.select({ totalConfirmed: sum(paymentsTable.amount) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.status, "confirmed"))),
    db.select({ totalPending: sum(paymentsTable.amount) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.status, "pending"))),
  ]);

  res.json({
    payments,
    total: Number(total),
    totalConfirmed: Number(totalConfirmed ?? 0),
    totalPending: Number(totalPending ?? 0),
  });
});

router.post("/", requirePermission("payments:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message });
    return;
  }

  const { activeWorkspaceId, userId } = req.sessionUser;
  const { amount, currency, paymentMethodId, method, contactId, orderId, reference, notes, paidAt } = parsed.data;

  try {
    let resolvedMethod: string = method ?? "other";
    let methodSnapshot: Record<string, unknown> | null = null;
    let resolvedPaymentMethodId: string | null = null;

    if (paymentMethodId) {
      const [pm] = await db.select().from(paymentMethodsTable)
        .where(and(eq(paymentMethodsTable.id, paymentMethodId), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
        .limit(1);
      if (!pm) { res.status(400).json({ error: "طريقة الدفع غير موجودة" }); return; }
      // 4A.2.1 — Block deactivated payment methods on creation
      if (!pm.isActive) {
        res.status(422).json({
          error: "طريقة الدفع معطّلة ولا يمكن استخدامها لتسجيل دفعة جديدة",
          code: "PAYMENT_METHOD_INACTIVE",
        });
        return;
      }
      resolvedMethod = pm.slug;
      resolvedPaymentMethodId = pm.id;
      methodSnapshot = {
        id: pm.id, slug: pm.slug, labelAr: pm.labelAr, labelEn: pm.labelEn,
        requiresReference: pm.requiresReference, requiresReceipt: pm.requiresReceipt,
      };
    }

    if (contactId) {
      const [c] = await db.select({ id: contactsTable.id }).from(contactsTable)
        .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, activeWorkspaceId))).limit(1);
      if (!c) { res.status(404).json({ error: "العميل غير موجود أو لا ينتمي لهذا الحساب" }); return; }
    }

    let resolvedOrderId: string | null = null;
    let orderContactId: string | null = null;
    let orderCurrency: string | null = null;
    if (orderId) {
      const [o] = await db.select({ id: ordersTable.id, currency: ordersTable.currency, contactId: ordersTable.contactId, status: ordersTable.status })
        .from(ordersTable)
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
      if (!o) { res.status(404).json({ error: "الطلب غير موجود أو لا ينتمي لهذا الحساب" }); return; }
      // R6 — منع تسجيل دفعات على طلبات ملغاة أو مُرتجعة
      if (o.status === "cancelled" || o.status === "returned") {
        res.status(422).json({
          error: `لا يمكن تسجيل دفعة على طلب ${o.status === "cancelled" ? "مُلغى" : "مُرتجع"}`,
          code: "ORDER_TERMINAL_STATE",
        });
        return;
      }
      resolvedOrderId = o.id;
      orderContactId = o.contactId;
      orderCurrency = o.currency;
    }

    let baseAmountYer: string | null = null;
    let exchangeRateId: string | null = null;
    let exchangeRateSnapshot: Record<string, unknown> | null = null;

    if (currency === "YER") {
      baseAmountYer = String(amount);
      exchangeRateSnapshot = { rate: 1, fromCurrency: "YER", toCurrency: "YER" };
    } else {
      const [rate] = await db.select().from(exchangeRatesTable)
        .where(and(
          eq(exchangeRatesTable.workspaceId, activeWorkspaceId),
          eq(exchangeRatesTable.fromCurrency, currency),
          eq(exchangeRatesTable.toCurrency, "YER"),
        ))
        .orderBy(desc(exchangeRatesTable.effectiveAt))
        .limit(1);

      if (!rate || Number(rate.rate) <= 0) {
        res.status(400).json({
          error: "يجب إدخال سعر الصرف قبل تسجيل دفعة بهذه العملة",
          code: "NO_EXCHANGE_RATE",
        });
        return;
      }

      baseAmountYer = String(amount * Number(rate.rate));
      exchangeRateId = rate.id;
      exchangeRateSnapshot = {
        id: rate.id, fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency,
        rate: rate.rate, effectiveAt: rate.effectiveAt,
      };
    }

    const effectiveContactId = contactId ?? orderContactId ?? null;

    const [payment] = await db.insert(paymentsTable).values({
      amount: String(amount),
      currency,
      method: resolvedMethod,
      paymentMethodId: resolvedPaymentMethodId,
      methodSnapshot,
      exchangeRateId,
      exchangeRateSnapshot,
      baseAmountYer,
      paidAt: paidAt ? new Date(paidAt) : null,
      status: "pending",
      contactId: effectiveContactId,
      orderId: resolvedOrderId,
      reference: reference ?? null,
      notes: notes ?? null,
      workspaceId: activeWorkspaceId,
      createdBy: userId,
    }).returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create", severity: "info", entityType: "payment",
      entityId: payment.id,
      entityLabel: `${amount} ${currency} — ${resolvedMethod}${orderCurrency ? ` (${orderId?.slice(0, 8)})` : ""}`,
      newData: { amount: String(amount), currency, method: resolvedMethod, status: "pending", contactId: effectiveContactId, orderId },
    });

    if (effectiveContactId) {
      await addContactTimeline({
        workspaceId: activeWorkspaceId, contactId: effectiveContactId,
        eventType: "payment_created",
        title: `تم تسجيل دفعة بمبلغ ${amount} ${currency} — ${resolvedMethod} (قيد الانتظار)`,
        entityType: "payment", entityId: payment.id, createdBy: userId,
      });
    }

    res.status(201).json({ payment });
  } catch (err) {
    logger.error({ err }, "Failed to create payment");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/:id", requirePermission("payments:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [payment] = await db.select({
    id: paymentsTable.id, amount: paymentsTable.amount, currency: paymentsTable.currency,
    method: paymentsTable.method, methodSnapshot: paymentsTable.methodSnapshot,
    status: paymentsTable.status, reference: paymentsTable.reference, notes: paymentsTable.notes,
    paidAt: paymentsTable.paidAt, confirmedAt: paymentsTable.confirmedAt, confirmedBy: paymentsTable.confirmedBy,
    rejectedAt: paymentsTable.rejectedAt, rejectedBy: paymentsTable.rejectedBy, rejectionReason: paymentsTable.rejectionReason,
    createdAt: paymentsTable.createdAt, updatedAt: paymentsTable.updatedAt,
    baseAmountYer: paymentsTable.baseAmountYer, exchangeRateSnapshot: paymentsTable.exchangeRateSnapshot,
    contactId: paymentsTable.contactId, orderId: paymentsTable.orderId,
    contactName: contactsTable.name, orderNumber: ordersTable.orderNumber,
  })
    .from(paymentsTable)
    .leftJoin(contactsTable, eq(paymentsTable.contactId, contactsTable.id))
    .leftJoin(ordersTable, eq(paymentsTable.orderId, ordersTable.id))
    .where(and(eq(paymentsTable.id, req.params.id as string), eq(paymentsTable.workspaceId, activeWorkspaceId)))
    .limit(1);

  if (!payment) { res.status(404).json({ error: "الدفعة غير موجودة" }); return; }

  let orderInfo: { totalAmount: string; paidAmount: string; paymentStatus: string } | null = null;
  if (payment.orderId) {
    const [o] = await db.select({ totalAmount: ordersTable.totalAmount, paidAmount: ordersTable.paidAmount })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, payment.orderId), eq(ordersTable.workspaceId, activeWorkspaceId)))
      .limit(1);
    if (o) {
      orderInfo = {
        totalAmount: o.totalAmount, paidAmount: o.paidAmount,
        paymentStatus: computePaymentStatus(o.totalAmount, o.paidAmount),
      };
    }
  }

  res.json({ payment, orderInfo });
});

router.patch("/:id", requirePermission("payments:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId } = req.sessionUser;

  const [existing] = await db.select({ id: paymentsTable.id, status: paymentsTable.status, contactId: paymentsTable.contactId })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, req.params.id as string), eq(paymentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الدفعة غير موجودة" }); return; }
  if (existing.status !== "pending") {
    res.status(422).json({ error: "لا يمكن تعديل دفعة مؤكدة أو مرفوضة" }); return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if ("reference" in parsed.data) updateData.reference = parsed.data.reference;
  if ("notes" in parsed.data) updateData.notes = parsed.data.notes;
  if ("paidAt" in parsed.data) updateData.paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : null;

  // 4A.2.1 — Validate new paymentMethodId if provided
  if (parsed.data.paymentMethodId !== undefined) {
    if (parsed.data.paymentMethodId === null) {
      // Explicitly clearing the method — not allowed, must always have a method
      res.status(400).json({ error: "يجب تحديد طريقة الدفع" }); return;
    }
    const [pm] = await db.select().from(paymentMethodsTable)
      .where(and(eq(paymentMethodsTable.id, parsed.data.paymentMethodId), eq(paymentMethodsTable.workspaceId, activeWorkspaceId)))
      .limit(1);
    if (!pm) { res.status(400).json({ error: "طريقة الدفع غير موجودة" }); return; }
    if (!pm.isActive) {
      res.status(422).json({
        error: "طريقة الدفع معطّلة ولا يمكن استخدامها لتسجيل دفعة جديدة",
        code: "PAYMENT_METHOD_INACTIVE",
      });
      return;
    }
    updateData.paymentMethodId = pm.id;
    updateData.method = pm.slug;
    updateData.methodSnapshot = {
      id: pm.id, slug: pm.slug, labelAr: pm.labelAr, labelEn: pm.labelEn,
      requiresReference: pm.requiresReference, requiresReceipt: pm.requiresReceipt,
    };
  }

  const [payment] = await db.update(paymentsTable).set(updateData)
    .where(and(eq(paymentsTable.id, req.params.id as string), eq(paymentsTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update", severity: "warning", entityType: "payment",
    entityId: payment.id, newData: updateData,
  });

  res.json({ payment });
});

router.post("/:id/confirm", paymentActionLimiter, requirePermission("payments:confirm"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;

  try {
    const [existing] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, req.params.id as string), eq(paymentsTable.workspaceId, activeWorkspaceId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "الدفعة غير موجودة" }); return; }
    if (existing.status !== "pending") {
      res.status(400).json({ error: "يمكن تأكيد الدفعات المعلّقة فقط" }); return;
    }

    // Pre-validate order before entering transaction
    if (existing.orderId) {
      const [order] = await db.select({
        id: ordersTable.id, totalAmount: ordersTable.totalAmount,
        paidAmount: ordersTable.paidAmount, currency: ordersTable.currency,
      })
        .from(ordersTable)
        .where(and(eq(ordersTable.id, existing.orderId), eq(ordersTable.workspaceId, activeWorkspaceId)))
        .limit(1);

      if (!order) { res.status(404).json({ error: "الطلب المرتبط بالدفعة غير موجود" }); return; }

      if (existing.currency !== order.currency) {
        res.status(400).json({ error: "عملة الدفعة يجب أن تطابق عملة الطلب في هذه المرحلة" }); return;
      }

      const remaining = Number(order.totalAmount) - Number(order.paidAmount);
      if (Number(existing.amount) > remaining + 0.001) {
        res.status(422).json({
          error: `مبلغ الدفعة يتجاوز المبلغ المتبقي للطلب (المتبقي: ${remaining.toFixed(2)} ${order.currency})`,
          code: "OVERPAYMENT",
          remaining: remaining.toFixed(2),
        });
        return;
      }
    }

    // R2 — Atomic transaction: update payment + order.paidAmount together
    const now = new Date();
    const { payment, updatedOrder } = await db.transaction(async (tx) => {
      let txUpdatedOrder: { id: string; totalAmount: string; paidAmount: string } | null = null;

      if (existing.orderId) {
        // Re-read inside transaction with FOR UPDATE semantics via select then update
        const [orderInTx] = await tx.select({
          id: ordersTable.id, totalAmount: ordersTable.totalAmount,
          paidAmount: ordersTable.paidAmount, currency: ordersTable.currency,
        })
          .from(ordersTable)
          .where(and(eq(ordersTable.id, existing.orderId), eq(ordersTable.workspaceId, activeWorkspaceId)))
          .limit(1);

        if (!orderInTx) throw new Error("ORDER_NOT_FOUND");

        // Re-check overpayment inside transaction
        const remainingInTx = Number(orderInTx.totalAmount) - Number(orderInTx.paidAmount);
        if (Number(existing.amount) > remainingInTx + 0.001) {
          throw new Error("OVERPAYMENT");
        }

        const newPaidAmount = Number(orderInTx.paidAmount) + Number(existing.amount);
        const newPaymentStatus = (() => {
          const t = Number(orderInTx.totalAmount);
          const p = newPaidAmount;
          if (p <= 0) return "unpaid";
          if (p >= t) return "paid";
          return "partial";
        })();
        const [upd] = await tx.update(ordersTable)
          .set({ paidAmount: String(newPaidAmount.toFixed(2)), paymentStatus: newPaymentStatus, updatedAt: now })
          .where(and(eq(ordersTable.id, orderInTx.id), eq(ordersTable.workspaceId, activeWorkspaceId)))
          .returning({ id: ordersTable.id, totalAmount: ordersTable.totalAmount, paidAmount: ordersTable.paidAmount });
        txUpdatedOrder = upd;
      }

      const [pmt] = await tx.update(paymentsTable)
        .set({
          status: "confirmed", confirmedBy: userId, confirmedAt: now,
          paidAt: existing.paidAt ?? now, updatedAt: now,
        })
        .where(and(eq(paymentsTable.id, existing.id), eq(paymentsTable.workspaceId, activeWorkspaceId)))
        .returning();

      return { payment: pmt, updatedOrder: txUpdatedOrder };
    });

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "confirm", severity: "critical", entityType: "payment",
      entityId: payment.id,
      entityLabel: `${existing.amount} ${existing.currency} — ${existing.method}`,
      oldData: { status: "pending", amount: existing.amount, currency: existing.currency },
      newData: {
        status: "confirmed", confirmedBy: userId, confirmedAt: now.toISOString(),
        orderId: existing.orderId, orderNewPaid: updatedOrder?.paidAmount,
      },
    });

    if (existing.contactId) {
      const orderPart = existing.orderId && updatedOrder
        ? ` للطلب (مدفوع: ${updatedOrder.paidAmount} من ${updatedOrder.totalAmount} ${existing.currency})`
        : "";
      await addContactTimeline({
        workspaceId: activeWorkspaceId, contactId: existing.contactId,
        eventType: "payment_confirmed",
        title: `تم تأكيد دفعة ${existing.amount} ${existing.currency}${orderPart}`,
        entityType: "payment", entityId: payment.id, createdBy: userId,
      });
    }

    await publishDomainEvent({
      eventType: "payment.confirmed",
      entityType: "payment",
      entityId: payment.id,
      payload: {
        contactId: existing.contactId,
        orderId: existing.orderId,
        amount: existing.amount,
        currency: existing.currency,
        method: existing.method,
      },
      sessionUser: req.sessionUser,
    });

    res.json({
      payment,
      orderPaidAmount: updatedOrder?.paidAmount ?? null,
      orderTotalAmount: updatedOrder?.totalAmount ?? null,
      orderPaymentStatus: updatedOrder
        ? computePaymentStatus(updatedOrder.totalAmount, updatedOrder.paidAmount)
        : null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "OVERPAYMENT") {
      res.status(422).json({ error: "مبلغ الدفعة يتجاوز المبلغ المتبقي للطلب", code: "OVERPAYMENT" });
      return;
    }
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      res.status(404).json({ error: "الطلب المرتبط بالدفعة غير موجود" });
      return;
    }
    logger.error({ err }, "Failed to confirm payment");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.post("/:id/reject", paymentActionLimiter, requirePermission("payments:reject"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;

  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "يجب إدخال سبب رفض الدفعة" });
    return;
  }

  const trimmedReason = parsed.data.reason.trim();
  if (!trimmedReason) {
    res.status(400).json({ error: "يجب إدخال سبب رفض الدفعة (لا يُقبل نص فارغ)" });
    return;
  }

  try {
    const [existing] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, req.params.id as string), eq(paymentsTable.workspaceId, activeWorkspaceId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "الدفعة غير موجودة" }); return; }
    if (existing.status !== "pending") {
      res.status(400).json({ error: "يمكن رفض الدفعات المعلّقة فقط" }); return;
    }

    const now = new Date();
    const [payment] = await db.update(paymentsTable)
      .set({ status: "rejected", rejectedBy: userId, rejectedAt: now, rejectionReason: trimmedReason, updatedAt: now })
      .where(and(eq(paymentsTable.id, req.params.id as string), eq(paymentsTable.workspaceId, activeWorkspaceId)))
      .returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "reject", severity: "critical", entityType: "payment",
      entityId: payment.id,
      entityLabel: `${existing.amount} ${existing.currency} — ${existing.method}`,
      oldData: { status: "pending", amount: existing.amount, currency: existing.currency },
      newData: { status: "rejected", rejectedBy: userId, rejectionReason: trimmedReason, rejectedAt: now.toISOString() },
    });

    if (existing.contactId) {
      await addContactTimeline({
        workspaceId: activeWorkspaceId, contactId: existing.contactId,
        eventType: "payment_rejected",
        title: `تم رفض دفعة ${existing.amount} ${existing.currency} — السبب: ${trimmedReason}`,
        entityType: "payment", entityId: payment.id, createdBy: userId,
      });
    }

    res.json({ payment });
  } catch (err) {
    logger.error({ err }, "Failed to reject payment");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
