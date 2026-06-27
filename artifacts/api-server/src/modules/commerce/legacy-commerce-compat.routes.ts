import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { ORDER_TRANSITIONS, type CommerceOrderState, CommerceConflictError } from "./commerce.constants";
import { transitionOrder } from "./order-lifecycle.service";

const router = Router();
router.use(requireSession);

const LEGACY_STATUS: Record<CommerceOrderState, string> = {
  Draft: "new",
  AwaitingConfirmation: "new",
  Confirmed: "confirmed",
  Reserved: "confirmed",
  Preparing: "processing",
  Ready: "ready",
  Shipped: "ready",
  Delivered: "delivered",
  Cancelled: "cancelled",
  Returned: "returned",
  Exchanged: "returned",
};

const CANONICAL_TARGET: Record<string, CommerceOrderState> = {
  new: "Draft",
  confirmed: "Confirmed",
  processing: "Preparing",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

function findPath(from: CommerceOrderState, target: CommerceOrderState): CommerceOrderState[] | null {
  if (from === target) return [];
  const queue: Array<{ state: CommerceOrderState; path: CommerceOrderState[] }> = [{ state: from, path: [] }];
  const visited = new Set<CommerceOrderState>([from]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of ORDER_TRANSITIONS[current.state] ?? []) {
      if (visited.has(next)) continue;
      const path = [...current.path, next];
      if (next === target) return path;
      visited.add(next);
      queue.push({ state: next, path });
    }
  }
  return null;
}

router.get("/products", requirePermission("products:read"), async (req: AuthenticatedRequest, res: Response) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const result = await pool.query(
    `SELECT p.id, p.name, p.description, p.sku, p.barcode, p.price, p.currency,
            p.unit, p.image_url AS "imageUrl", p.images, p.delivery_policy AS "deliveryPolicy",
            p.is_archived AS "isArchived", p.status, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            chosen.id AS "defaultVariantId", chosen.title AS "defaultVariantTitle",
            chosen.price AS "minimumPrice", chosen.price, chosen.currency,
            chosen.location_id AS "defaultLocationId",
            COALESCE(chosen.available, 0)::int AS available,
            COALESCE(chosen.available, 0)::int AS "quantityAvailable",
            (SELECT COUNT(*)::int FROM product_variants allv
             WHERE allv.workspace_id = p.workspace_id AND allv.product_id = p.id) AS "variantCount"
     FROM inventory_products p
     LEFT JOIN LATERAL (
       SELECT v.id, v.title, v.price, v.currency, l.location_id, l.available
       FROM product_variants v
       LEFT JOIN inventory_stock_levels l
         ON l.workspace_id = v.workspace_id AND l.product_variant_id = v.id
       WHERE v.workspace_id = p.workspace_id AND v.product_id = p.id AND v.status = 'active'
       ORDER BY v.is_default DESC, v.created_at ASC, l.available DESC NULLS LAST
       LIMIT 1
     ) chosen ON true
     WHERE p.workspace_id = $1 AND p.is_archived = false AND p.status = 'active'
       AND ($2::text = '' OR p.name ILIKE '%' || $2 || '%')
     ORDER BY p.name ASC`,
    [req.sessionUser.activeWorkspaceId, search],
  );
  res.json({ products: result.rows });
});

router.get("/orders", requirePermission("orders:read"), async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.sessionUser.activeWorkspaceId;
  const requestedStatus = typeof req.query.status === "string" ? req.query.status : "";
  const channel = typeof req.query.channel === "string" ? req.query.channel : "";
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const result = await pool.query(
    `SELECT o.id, o.order_number AS "orderNumber", o.status, o.channel,
            o.total_amount AS "totalAmount", o.paid_amount AS "paidAmount", o.discount, o.currency,
            o.notes, o.contact_id AS "contactId", o.conversation_id AS "conversationId",
            o.opportunity_id AS "opportunityId", o.confirmed_at AS "confirmedAt",
            o.delivered_at AS "deliveredAt", o.cancelled_at AS "cancelledAt",
            o.returned_at AS "returnedAt", o.cancel_reason AS "cancelReason",
            o.returned_reason AS "returnedReason", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
            o.delivery_type AS "deliveryType", o.delivery_status AS "deliveryStatus",
            o.delivery_fee AS "deliveryFee", o.cod_enabled AS "codEnabled",
            c.name AS "contactName", c.phone AS "contactPhone"
     FROM orders o LEFT JOIN contacts c ON c.id = o.contact_id AND c.workspace_id = o.workspace_id
     WHERE o.workspace_id = $1
       AND ($2::text = '' OR o.channel = $2)
       AND ($3::text = '' OR o.order_number ILIKE '%' || $3 || '%')
     ORDER BY o.created_at DESC LIMIT $4`,
    [workspaceId, channel, search, limit],
  );
  const mapped = result.rows.map((order) => ({
    ...order,
    canonicalStatus: order.status,
    status: LEGACY_STATUS[order.status as CommerceOrderState] ?? order.status,
  }));
  const filtered = requestedStatus ? mapped.filter((order) => order.status === requestedStatus) : mapped;
  const countResult = await pool.query<{ status: CommerceOrderState; count: string }>(
    "SELECT status, COUNT(*)::text AS count FROM orders WHERE workspace_id = $1 GROUP BY status",
    [workspaceId],
  );
  const counts: Record<string, number> = {};
  for (const row of countResult.rows) {
    const key = LEGACY_STATUS[row.status] ?? row.status;
    counts[key] = (counts[key] ?? 0) + Number(row.count);
  }
  res.json({ orders: filtered, total: filtered.length, counts });
});

router.get("/orders/:id", requirePermission("orders:read"), async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.sessionUser.activeWorkspaceId;
  const result = await pool.query(
    `SELECT o.*, c.name AS "contactName", c.phone AS "contactPhone"
     FROM orders o LEFT JOIN contacts c ON c.id = o.contact_id AND c.workspace_id = o.workspace_id
     WHERE o.id = $1 AND o.workspace_id = $2 LIMIT 1`,
    [req.params.id, workspaceId],
  );
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }
  const items = await pool.query(
    `SELECT id, inventory_product_id AS "inventoryProductId", product_variant_id AS "productVariantId",
            location_id AS "locationId", name, description, quantity, unit_price AS "unitPrice",
            discount, tax, currency, total, snapshot, reservation_status AS "reservationStatus",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM order_items WHERE order_id = $1 AND workspace_id = $2 ORDER BY created_at`,
    [req.params.id, workspaceId],
  );
  const order = {
    id: row.id,
    orderNumber: row.order_number,
    status: LEGACY_STATUS[row.status as CommerceOrderState] ?? row.status,
    canonicalStatus: row.status,
    channel: row.channel,
    totalAmount: row.total_amount,
    paidAmount: row.paid_amount,
    paymentStatus: row.payment_status,
    discount: row.discount,
    currency: row.currency,
    notes: row.notes,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    opportunityId: row.opportunity_id,
    assignedMembershipId: row.assigned_membership_id,
    cancelReason: row.cancel_reason,
    returnedReason: row.returned_reason,
    deliveryType: row.delivery_type,
    deliveryStatus: row.delivery_status,
    deliveryAgentPhone: row.delivery_agent_phone,
    carrierName: row.carrier_name,
    carrierPhone: row.carrier_phone,
    deliveryReceiptUrl: row.delivery_receipt_url,
    deliveryAddress: row.delivery_address,
    deliveryFee: row.delivery_fee,
    codEnabled: row.cod_enabled,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  res.json({ order, items: items.rows });
});

const legacyItemSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().int().min(1),
  discount: z.number().min(0).optional(),
});

router.post("/orders/:id/items", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.body?.productVariantId && req.body?.locationId) {
    next();
    return;
  }
  const parsed = legacyItemSchema.safeParse(req.body);
  if (!parsed.success) {
    next();
    return;
  }
  const product = await pool.query<{
    variant_id: string; location_id: string;
  }>(
    `SELECT v.id AS variant_id, l.location_id
     FROM inventory_products p
     JOIN product_variants v ON v.workspace_id = p.workspace_id AND v.product_id = p.id AND v.status = 'active'
     JOIN inventory_stock_levels l ON l.workspace_id = v.workspace_id AND l.product_variant_id = v.id
     WHERE p.workspace_id = $1 AND p.status = 'active' AND p.name = $2 AND l.available >= $3
     ORDER BY v.is_default DESC, l.available DESC LIMIT 1`,
    [req.sessionUser.activeWorkspaceId, parsed.data.name, parsed.data.quantity],
  );
  const match = product.rows[0];
  if (!match) {
    res.status(422).json({ error: "اختر منتجًا حقيقيًا بكمية متاحة من المخزون", code: "CATALOG_ITEM_REQUIRED" });
    return;
  }
  req.body = {
    productVariantId: match.variant_id,
    locationId: match.location_id,
    quantity: parsed.data.quantity,
    discount: parsed.data.discount ?? 0,
  };
  next();
});

const legacyStatusSchema = z.object({
  status: z.enum(["new", "confirmed", "processing", "ready", "delivered", "cancelled", "returned"]),
  cancelReason: z.string().optional(),
  returnedReason: z.string().optional(),
});

router.patch("/orders/:id/status", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (typeof req.body?.idempotencyKey === "string") {
    next();
    return;
  }
  const parsed = legacyStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    next();
    return;
  }
  if (parsed.data.status === "cancelled" && !req.sessionUser.permissions.includes("orders:cancel")) {
    res.status(403).json({ error: "ليس لديك صلاحية إلغاء الطلبات", code: "FORBIDDEN" });
    return;
  }
  const existing = await pool.query<{ status: CommerceOrderState }>(
    "SELECT status FROM orders WHERE id = $1 AND workspace_id = $2",
    [req.params.id, req.sessionUser.activeWorkspaceId],
  );
  const current = existing.rows[0]?.status;
  if (!current) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }
  const target = CANONICAL_TARGET[parsed.data.status];
  const path = findPath(current, target);
  if (path === null) {
    res.status(409).json({ error: `لا يمكن تغيير حالة الطلب من ${current} إلى ${target}`, code: "INVALID_ORDER_TRANSITION" });
    return;
  }
  const baseKey = req.id || crypto.randomUUID();
  const reason = parsed.data.status === "cancelled" ? parsed.data.cancelReason : parsed.data.returnedReason;
  try {
    let fromState = current;
    for (let index = 0; index < path.length; index += 1) {
      const step = path[index]!;
      await transitionOrder({
        workspaceId: req.sessionUser.activeWorkspaceId,
        orderId: req.params.id as string,
        targetState: step,
        userId: req.sessionUser.userId,
        correlationId: baseKey,
        idempotencyKey: `${baseKey}:${index}:${step}`,
        reason,
      });
      fromState = step;
    }
    res.json({ order: { id: req.params.id, status: LEGACY_STATUS[fromState] ?? fromState, canonicalStatus: fromState } });
  } catch (error) {
    if (error instanceof CommerceConflictError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

router.post("/payments", requirePermission("payments:create"), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.body?.method && req.body?.idempotencyKey) {
    next();
    return;
  }
  if (!req.body?.paymentMethodId) {
    next();
    return;
  }
  const methodResult = await pool.query<{ slug: string }>(
    "SELECT slug FROM payment_methods WHERE id = $1 AND workspace_id = $2 AND is_active = true",
    [req.body.paymentMethodId, req.sessionUser.activeWorkspaceId],
  );
  const slug = methodResult.rows[0]?.slug;
  if (!slug) {
    res.status(404).json({ error: "طريقة الدفع غير موجودة أو معطلة" });
    return;
  }
  const methods: Record<string, string> = {
    cash: "Cash",
    cod: "CashOnDelivery",
    transfer: "BankTransfer",
    bank: "BankTransfer",
    bank_transfer: "BankTransfer",
    kuraimi: "Wallet",
    jawali: "Wallet",
    wallet: "Wallet",
    other: "ManualPayment",
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
    idempotencyKey: req.id || crypto.randomUUID(),
  };
  next();
});

export default router;
