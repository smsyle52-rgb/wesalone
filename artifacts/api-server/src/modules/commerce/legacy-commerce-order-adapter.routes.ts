import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { ORDER_TRANSITIONS, type CommerceOrderState, CommerceConflictError } from "./commerce.constants";
import { transitionOrder } from "./order-lifecycle.service";
import { requestIdOrFallback, singleStringParameter } from "./request-values";

const router = Router();
const LEGACY_STATUS: Record<CommerceOrderState, string> = { Draft: "new", AwaitingConfirmation: "new", Confirmed: "confirmed", Reserved: "confirmed", Preparing: "processing", Ready: "ready", Shipped: "ready", Delivered: "delivered", Cancelled: "cancelled", Returned: "returned", Exchanged: "returned" };
const CANONICAL_TARGET: Record<string, CommerceOrderState> = { new: "Draft", confirmed: "Confirmed", processing: "Preparing", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned" };
const legacyItemSchema = z.object({ name: z.string().trim().min(1), quantity: z.number().int().min(1), discount: z.number().min(0).optional() });

router.post("/orders/:id/items", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.body?.productVariantId && req.body?.locationId) { next(); return; }
  const parsed = legacyItemSchema.safeParse(req.body);
  if (!parsed.success) { next(); return; }
  const product = await pool.query<{ variant_id: string; location_id: string }>(
    `SELECT v.id AS variant_id, l.location_id FROM inventory_products p
     JOIN product_variants v ON v.workspace_id = p.workspace_id AND v.product_id = p.id AND v.status = 'active'
     JOIN inventory_stock_levels l ON l.workspace_id = v.workspace_id AND l.product_variant_id = v.id
     WHERE p.workspace_id = $1 AND p.status = 'active' AND p.name = $2 AND l.available >= $3
     ORDER BY v.is_default DESC, l.available DESC LIMIT 1`,
    [req.sessionUser.activeWorkspaceId, parsed.data.name, parsed.data.quantity],
  );
  const match = product.rows[0];
  if (!match) { res.status(422).json({ error: "Catalog item with available stock is required", code: "CATALOG_ITEM_REQUIRED" }); return; }
  req.body = { productVariantId: match.variant_id, locationId: match.location_id, quantity: parsed.data.quantity, discount: parsed.data.discount ?? 0 };
  next();
});

const legacyStatusSchema = z.object({ status: z.enum(["new", "confirmed", "processing", "ready", "delivered", "cancelled", "returned"]), cancelReason: z.string().optional(), returnedReason: z.string().optional() });
router.patch("/orders/:id/status", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (typeof req.body?.idempotencyKey === "string") { next(); return; }
  const parsed = legacyStatusSchema.safeParse(req.body);
  if (!parsed.success) { next(); return; }
  if (parsed.data.status === "cancelled" && !req.sessionUser.permissions.includes("orders:cancel")) { res.status(403).json({ error: "Missing order cancellation permission", code: "FORBIDDEN" }); return; }
  const orderIdResult = singleStringParameter(req.params.id);
  if (!orderIdResult.ok) { res.status(400).json({ error: "Order id must be a single non-empty value", code: "INVALID_ROUTE_PARAMETER" }); return; }
  const orderId = orderIdResult.value;
  const existing = await pool.query<{ status: CommerceOrderState }>("SELECT status FROM orders WHERE id = $1 AND workspace_id = $2", [orderId, req.sessionUser.activeWorkspaceId]);
  const current = existing.rows[0]?.status;
  if (!current) { res.status(404).json({ error: "Order not found" }); return; }
  if (LEGACY_STATUS[current] === parsed.data.status) { res.json({ order: { id: orderId, status: parsed.data.status, canonicalStatus: current }, idempotent: true }); return; }
  const target = CANONICAL_TARGET[parsed.data.status];
  if (!(ORDER_TRANSITIONS[current] ?? []).includes(target)) { res.status(409).json({ error: `Cannot transition order from ${current} to ${target}`, code: "INVALID_ORDER_TRANSITION" }); return; }
  const baseKey = requestIdOrFallback(req.id, crypto.randomUUID());
  const reason = parsed.data.status === "cancelled" ? parsed.data.cancelReason : parsed.data.returnedReason;
  try {
    const transition = await transitionOrder({ workspaceId: req.sessionUser.activeWorkspaceId, orderId, targetState: target, userId: req.sessionUser.userId, correlationId: baseKey, idempotencyKey: `legacy:${baseKey}:${target}`, reason });
    res.json({ order: { id: orderId, status: LEGACY_STATUS[transition.toState] ?? transition.toState, canonicalStatus: transition.toState }, transition });
  } catch (error) {
    if (error instanceof CommerceConflictError) { res.status(409).json({ error: error.message, code: error.code }); return; }
    throw error;
  }
});
export default router;
