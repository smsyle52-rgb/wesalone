import { Router } from "express";
import { pool } from "@workspace/db";
import { requirePermission } from "../../middlewares/requirePermission";
import { requestIdOrFallback } from "./request-values";
const router = Router();
router.post("/payments", requirePermission("payments:create"), async (req, res, next) => {
  if (req.body?.method && req.body?.idempotencyKey) { next(); return; }
  if (!req.body?.paymentMethodId) { next(); return; }
  const methodResult = await pool.query(
    "SELECT slug FROM payment_methods WHERE id = $1 AND workspace_id = $2 AND is_active = true",
    [req.body.paymentMethodId, req.sessionUser.activeWorkspaceId],
  );
  const slug = methodResult.rows[0]?.slug;
  if (!slug) { res.status(404).json({ error: "Payment method is unavailable" }); return; }
  const methods = {
    cash: "Cash", cod: "CashOnDelivery", transfer: "BankTransfer", bank: "BankTransfer",
    bank_transfer: "BankTransfer", kuraimi: "Wallet", jawali: "Wallet", wallet: "Wallet", other: "ManualPayment",
  };
  req.body = {
    orderId: req.body.orderId,
    amount: Number(req.body.amount),
    currency: req.body.currency,
    method: methods[slug] ?? "ManualPayment",
    externalReference: req.body.reference ?? null,
    receiptUrl: req.body.receiptUrl ?? null,
    notes: req.body.notes ?? null,
    paidAt: req.body.paidAt ?? null,
    idempotencyKey: requestIdOrFallback(req.id, crypto.randomUUID()),
  };
  next();
});
export default router;
