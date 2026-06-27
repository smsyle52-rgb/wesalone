import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const PAYMENT_METHODS = ["Cash", "CashOnDelivery", "BankTransfer", "Wallet", "ManualPayment", "PaymentGateway"] as const;

const createPaymentSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.enum(["YER", "SAR", "USD"]),
  method: z.enum(PAYMENT_METHODS),
  externalReference: z.string().trim().max(200).optional().nullable(),
  receiptUrl: z.string().url().max(2000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const refundSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(3).max(1000),
  externalReference: z.string().trim().max(200).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

function paymentStatus(total: number, netPaid: number, refunded: number) {
  if (refunded > 0 && netPaid <= 0) return "Refunded";
  if (refunded > 0) return "PartiallyRefunded";
  if (netPaid <= 0) return "Unpaid";
  if (netPaid + 0.001 >= total) return "Paid";
  return "PartiallyPaid";
}

async function recalculateOrderPayment(client: import("pg").PoolClient, workspaceId: string, orderId: string) {
  const orderResult = await client.query<{ total_amount: string }>(
    "SELECT total_amount FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
    [orderId, workspaceId],
  );
  const order = orderResult.rows[0];
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const paidResult = await client.query<{ paid: string; refunded: string }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM payments
                 WHERE workspace_id = $1 AND order_id = $2 AND status IN ('Paid','confirmed')), 0)::text AS paid,
       COALESCE((SELECT SUM(r.amount) FROM payment_refunds r
                 JOIN payments p ON p.id = r.payment_id AND p.workspace_id = r.workspace_id
                 WHERE r.workspace_id = $1 AND r.order_id = $2 AND r.status IN ('Refunded','confirmed')), 0)::text AS refunded`,
    [workspaceId, orderId],
  );
  const paid = Number(paidResult.rows[0]!.paid);
  const refunded = Number(paidResult.rows[0]!.refunded);
  const netPaid = Math.max(0, paid - refunded);
  const status = paymentStatus(Number(order.total_amount), netPaid, refunded);
  await client.query(
    "UPDATE orders SET paid_amount = $1, payment_status = $2, updated_at = now(), version = version + 1 WHERE id = $3 AND workspace_id = $4",
    [netPaid.toFixed(2), status, orderId, workspaceId],
  );
  return { totalAmount: Number(order.total_amount), paid, refunded, netPaid, remaining: Math.max(0, Number(order.total_amount) - netPaid), status };
}

router.get("/", requirePermission("payments:read"), async (req: AuthenticatedRequest, res: Response) => {
  const orderId = typeof req.query.orderId === "string" ? req.query.orderId : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const result = await pool.query(
    `SELECT p.id, p.order_id AS "orderId", p.contact_id AS "contactId", p.amount, p.currency,
            p.method, p.status, p.external_reference AS "externalReference",
            p.receipt_url AS "receiptUrl", p.notes, p.paid_at AS "paidAt",
            p.confirmed_at AS "confirmedAt", p.rejected_at AS "rejectedAt",
            p.rejection_reason AS "rejectionReason", p.created_at AS "createdAt",
            o.order_number AS "orderNumber", o.total_amount AS "orderTotal",
            o.paid_amount AS "orderPaid", o.payment_status AS "orderPaymentStatus"
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id AND o.workspace_id = p.workspace_id
     WHERE p.workspace_id = $1
       AND ($2::uuid IS NULL OR p.order_id = $2)
       AND ($3::text IS NULL OR p.status = $3)
     ORDER BY p.created_at DESC LIMIT $4`,
    [req.sessionUser.activeWorkspaceId, orderId, status, limit],
  );
  res.json({ payments: result.rows });
});

router.post("/", requirePermission("payments:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات الدفعة غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prior = await client.query(
      "SELECT * FROM payments WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1",
      [activeWorkspaceId, parsed.data.idempotencyKey],
    );
    if (prior.rows[0]) {
      await client.query("COMMIT");
      res.json({ payment: prior.rows[0], idempotent: true });
      return;
    }

    const orderResult = await client.query<{
      id: string; total_amount: string; currency: string; contact_id: string | null; status: string;
    }>(
      `SELECT id, total_amount, currency, contact_id, status FROM orders
       WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [parsed.data.orderId, activeWorkspaceId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (["Cancelled", "Returned"].includes(order.status)) throw new Error("ORDER_TERMINAL");
    if (order.currency !== parsed.data.currency) throw new Error("CURRENCY_MISMATCH");

    const committedResult = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM payments
       WHERE workspace_id = $1 AND order_id = $2 AND status IN ('Pending','Paid','pending','confirmed')`,
      [activeWorkspaceId, order.id],
    );
    const committed = Number(committedResult.rows[0]!.total);
    if (committed + parsed.data.amount > Number(order.total_amount) + 0.001) throw new Error("OVERPAYMENT");

    const result = await client.query(
      `INSERT INTO payments
       (workspace_id, order_id, contact_id, amount, currency, method, status,
        external_reference, receipt_url, reference, notes, paid_at, created_by, recorded_by,
        correlation_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,$8,$7,$9,$10,$11,$11,$12,$13)
       RETURNING *`,
      [activeWorkspaceId, order.id, order.contact_id, parsed.data.amount, parsed.data.currency,
        parsed.data.method, parsed.data.externalReference ?? null, parsed.data.receiptUrl ?? null,
        parsed.data.notes ?? null, parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
        userId, req.id || crypto.randomUUID(), parsed.data.idempotencyKey],
    );
    await client.query(
      `UPDATE orders SET payment_status = CASE
         WHEN paid_amount > 0 THEN payment_status ELSE 'Pending' END, updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [order.id, activeWorkspaceId],
    );
    await client.query("COMMIT");

    const payment = result.rows[0];
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "create",
      entityType: "payment",
      entityId: payment.id,
      entityLabel: `${parsed.data.amount} ${parsed.data.currency} — ${parsed.data.method}`,
      newData: { orderId: order.id, status: "Pending", hasReceipt: Boolean(parsed.data.receiptUrl) },
    });
    res.status(201).json({ payment, idempotent: false });
  } catch (error) {
    await client.query("ROLLBACK");
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      ORDER_NOT_FOUND: "الطلب غير موجود",
      ORDER_TERMINAL: "لا يمكن تسجيل دفعة على طلب ملغي أو مرتجع",
      CURRENCY_MISMATCH: "عملة الدفعة لا تطابق عملة الطلب",
      OVERPAYMENT: "مجموع الدفعات المعلقة والمؤكدة يتجاوز قيمة الطلب",
    };
    if (messages[code]) {
      res.status(code === "ORDER_NOT_FOUND" ? 404 : 409).json({ error: messages[code], code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post("/:id/confirm", requirePermission("payments:confirm"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const paymentResult = await client.query<{
      id: string; order_id: string | null; amount: string; status: string; currency: string; method: string;
    }>(
      "SELECT id, order_id, amount, status, currency, method FROM payments WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [req.params.id, activeWorkspaceId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (["Paid", "confirmed"].includes(payment.status)) {
      const summary = payment.order_id ? await recalculateOrderPayment(client, activeWorkspaceId, payment.order_id) : null;
      await client.query("COMMIT");
      res.json({ payment, summary, idempotent: true });
      return;
    }
    if (!["Pending", "pending"].includes(payment.status)) throw new Error("PAYMENT_NOT_PENDING");

    await client.query(
      `UPDATE payments SET status = 'Paid', confirmed_by = $1, verified_by = $1,
              confirmed_at = now(), paid_at = COALESCE(paid_at, now()), updated_at = now()
       WHERE id = $2 AND workspace_id = $3`,
      [userId, payment.id, activeWorkspaceId],
    );
    const summary = payment.order_id ? await recalculateOrderPayment(client, activeWorkspaceId, payment.order_id) : null;
    await client.query("COMMIT");

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "confirm",
      severity: "critical",
      entityType: "payment",
      entityId: payment.id,
      oldData: { status: payment.status },
      newData: { status: "Paid", summary },
    });
    await publishDomainEvent({
      eventType: "payment.confirmed",
      entityType: "payment",
      entityId: payment.id,
      payload: { orderId: payment.order_id, amount: payment.amount, currency: payment.currency, method: payment.method, summary },
      sessionUser: req.sessionUser,
    });
    res.json({ payment: { ...payment, status: "Paid" }, summary, idempotent: false });
  } catch (error) {
    await client.query("ROLLBACK");
    const code = error instanceof Error ? error.message : "";
    if (code === "PAYMENT_NOT_FOUND" || code === "PAYMENT_NOT_PENDING" || code === "ORDER_NOT_FOUND") {
      res.status(code.includes("NOT_FOUND") ? 404 : 409).json({ error: code === "PAYMENT_NOT_PENDING" ? "يمكن اعتماد الدفعات المعلقة فقط" : "السجل المطلوب غير موجود", code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post("/:id/reject", requirePermission("payments:reject"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "سبب الرفض مطلوب" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const result = await pool.query(
    `UPDATE payments SET status = 'Failed', rejected_by = $1, rejected_at = now(),
            rejection_reason = $2, updated_at = now()
     WHERE id = $3 AND workspace_id = $4 AND status IN ('Pending','pending')
     RETURNING *`,
    [userId, parsed.data.reason, req.params.id, activeWorkspaceId],
  );
  if (!result.rowCount) {
    res.status(409).json({ error: "الدفعة غير موجودة أو لم تعد معلقة", code: "PAYMENT_NOT_PENDING" });
    return;
  }
  const payment = result.rows[0];
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    workspaceId: activeWorkspaceId,
    action: "reject",
    severity: "warning",
    entityType: "payment",
    entityId: payment.id,
    newData: { status: "Failed", reason: parsed.data.reason },
  });
  res.json({ payment });
});

router.post("/:id/refunds", requirePermission("payments:refund"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات الاسترجاع غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prior = await client.query(
      "SELECT * FROM payment_refunds WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1",
      [activeWorkspaceId, parsed.data.idempotencyKey],
    );
    if (prior.rows[0]) {
      await client.query("COMMIT");
      res.json({ refund: prior.rows[0], idempotent: true });
      return;
    }
    const paymentResult = await client.query<{
      id: string; order_id: string | null; amount: string; currency: string; status: string;
    }>(
      "SELECT id, order_id, amount, currency, status FROM payments WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [req.params.id, activeWorkspaceId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (!["Paid", "PartiallyRefunded", "confirmed"].includes(payment.status)) throw new Error("PAYMENT_NOT_REFUNDABLE");
    const refundsResult = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM payment_refunds
       WHERE workspace_id = $1 AND payment_id = $2 AND status IN ('Pending','Refunded','pending','confirmed')`,
      [activeWorkspaceId, payment.id],
    );
    if (Number(refundsResult.rows[0]!.total) + parsed.data.amount > Number(payment.amount) + 0.001) throw new Error("OVER_REFUND");
    const result = await client.query(
      `INSERT INTO payment_refunds
       (workspace_id, payment_id, order_id, amount, currency, status, reason,
        external_reference, recorded_by, correlation_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'Pending',$6,$7,$8,$9,$10) RETURNING *`,
      [activeWorkspaceId, payment.id, payment.order_id, parsed.data.amount, payment.currency,
        parsed.data.reason, parsed.data.externalReference ?? null, userId,
        req.id || crypto.randomUUID(), parsed.data.idempotencyKey],
    );
    await client.query("COMMIT");
    res.status(201).json({ refund: result.rows[0], idempotent: false });
  } catch (error) {
    await client.query("ROLLBACK");
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      PAYMENT_NOT_FOUND: "الدفعة غير موجودة",
      PAYMENT_NOT_REFUNDABLE: "لا يمكن استرجاع مبلغ من دفعة غير معتمدة",
      OVER_REFUND: "مجموع مبالغ الاسترجاع يتجاوز قيمة الدفعة",
    };
    if (messages[code]) {
      res.status(code === "PAYMENT_NOT_FOUND" ? 404 : 409).json({ error: messages[code], code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post("/refunds/:refundId/confirm", requirePermission("payments:refund"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const refundResult = await client.query<{
      id: string; payment_id: string; order_id: string | null; amount: string; status: string;
    }>(
      "SELECT id, payment_id, order_id, amount, status FROM payment_refunds WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [req.params.refundId, activeWorkspaceId],
    );
    const refund = refundResult.rows[0];
    if (!refund) throw new Error("REFUND_NOT_FOUND");
    if (refund.status === "Refunded") {
      const summary = refund.order_id ? await recalculateOrderPayment(client, activeWorkspaceId, refund.order_id) : null;
      await client.query("COMMIT");
      res.json({ refund, summary, idempotent: true });
      return;
    }
    if (refund.status !== "Pending") throw new Error("REFUND_NOT_PENDING");
    await client.query(
      `UPDATE payment_refunds SET status = 'Refunded', verified_by = $1,
              refunded_at = now(), updated_at = now()
       WHERE id = $2 AND workspace_id = $3`,
      [userId, refund.id, activeWorkspaceId],
    );
    const paymentTotals = await client.query<{ refunded: string; amount: string }>(
      `SELECT COALESCE(SUM(r.amount),0)::text AS refunded, p.amount::text
       FROM payments p LEFT JOIN payment_refunds r
         ON r.payment_id = p.id AND r.workspace_id = p.workspace_id AND r.status = 'Refunded'
       WHERE p.id = $1 AND p.workspace_id = $2 GROUP BY p.amount`,
      [refund.payment_id, activeWorkspaceId],
    );
    const totals = paymentTotals.rows[0]!;
    const paymentState = Number(totals.refunded) + 0.001 >= Number(totals.amount) ? "Refunded" : "PartiallyRefunded";
    await client.query(
      "UPDATE payments SET status = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
      [paymentState, refund.payment_id, activeWorkspaceId],
    );
    const summary = refund.order_id ? await recalculateOrderPayment(client, activeWorkspaceId, refund.order_id) : null;
    await client.query("COMMIT");

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "confirm",
      severity: "critical",
      entityType: "payment_refund",
      entityId: refund.id,
      newData: { status: "Refunded", amount: refund.amount, summary },
    });
    res.json({ refund: { ...refund, status: "Refunded" }, summary, idempotent: false });
  } catch (error) {
    await client.query("ROLLBACK");
    const code = error instanceof Error ? error.message : "";
    if (code === "REFUND_NOT_FOUND" || code === "REFUND_NOT_PENDING" || code === "ORDER_NOT_FOUND") {
      res.status(code.includes("NOT_FOUND") ? 404 : 409).json({ error: code === "REFUND_NOT_PENDING" ? "يمكن اعتماد طلبات الاسترجاع المعلقة فقط" : "السجل المطلوب غير موجود", code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

export default router;
