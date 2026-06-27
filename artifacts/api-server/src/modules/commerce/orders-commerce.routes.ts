import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";
import { ORDER_STATES, CommerceConflictError } from "./commerce.constants";
import { transitionOrder } from "./order-lifecycle.service";
import orderCreateRouter from "./order-create.routes";

const router = Router();
router.use(requireSession);
router.use(orderCreateRouter);

const catalogItemSchema = z.object({
  productVariantId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100000),
  discount: z.number().min(0).default(0),
});

const transitionSchema = z.object({
  status: z.enum(ORDER_STATES),
  reason: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  reservationExpiresAt: z.string().datetime().optional().nullable(),
});

function commerceError(error: unknown, res: Response) {
  if (error instanceof CommerceConflictError) {
    res.status(409).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

router.post("/:id/items", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = catalogItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات البند غير صحيحة" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{
      id: string; order_number: string; status: string; currency: string; discount: string; delivery_fee: string;
    }>(
      `SELECT id, order_number, status, currency, discount, delivery_fee
       FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [req.params.id, activeWorkspaceId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");
    if (!["Draft", "AwaitingConfirmation"].includes(order.status)) {
      throw new CommerceConflictError("ORDER_ITEMS_LOCKED", "لا يمكن تعديل بنود الطلب بعد التأكيد");
    }

    const variantResult = await client.query<{
      id: string; product_id: string; title: string; sku: string | null; barcode: string | null;
      option_values: Record<string, string>; price: string; currency: string; product_name: string;
      product_description: string | null; location_name: string; available: number;
    }>(
      `SELECT v.id, v.product_id, v.title, v.sku, v.barcode, v.option_values, v.price, v.currency,
              p.name AS product_name, p.description AS product_description,
              s.name AS location_name, l.available
       FROM product_variants v
       JOIN inventory_products p ON p.id = v.product_id AND p.workspace_id = v.workspace_id
       JOIN inventory_stock_levels l ON l.product_variant_id = v.id AND l.workspace_id = v.workspace_id
       JOIN stock_locations s ON s.id = l.location_id AND s.workspace_id = v.workspace_id
       WHERE v.id = $1 AND l.location_id = $2 AND v.workspace_id = $3
         AND v.status = 'active' AND p.status = 'active' AND s.is_active = true
       FOR UPDATE OF l`,
      [parsed.data.productVariantId, parsed.data.locationId, activeWorkspaceId],
    );
    const variant = variantResult.rows[0];
    if (!variant) throw new CommerceConflictError("VARIANT_NOT_AVAILABLE", "المتغير أو موقع المخزون غير متاح");
    if (variant.currency !== order.currency) {
      throw new CommerceConflictError("CURRENCY_MISMATCH", "عملة المتغير لا تطابق عملة الطلب");
    }
    if (variant.available < parsed.data.quantity) {
      throw new CommerceConflictError("INSUFFICIENT_STOCK", `الكمية المتاحة ${variant.available} فقط`);
    }

    const subtotal = Number(variant.price) * parsed.data.quantity;
    if (parsed.data.discount > subtotal) {
      throw new CommerceConflictError("INVALID_DISCOUNT", "الخصم لا يمكن أن يتجاوز قيمة البند");
    }
    const tax = 0;
    const total = subtotal - parsed.data.discount + tax;
    const snapshot = {
      productName: variant.product_name,
      productDescription: variant.product_description,
      variantTitle: variant.title,
      optionValues: variant.option_values,
      sku: variant.sku,
      barcode: variant.barcode,
      unitPrice: variant.price,
      currency: variant.currency,
      locationName: variant.location_name,
      capturedAt: new Date().toISOString(),
    };
    const itemResult = await client.query(
      `INSERT INTO order_items
       (workspace_id, order_id, inventory_product_id, product_variant_id, location_id,
        name, description, quantity, unit_price, discount, tax, currency, total, snapshot, reservation_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'none')
       RETURNING *`,
      [activeWorkspaceId, order.id, variant.product_id, variant.id, parsed.data.locationId,
        variant.product_name, variant.title, parsed.data.quantity, variant.price,
        parsed.data.discount, tax, variant.currency, total, JSON.stringify(snapshot)],
    );
    const totals = await client.query<{ items_total: string }>(
      "SELECT COALESCE(SUM(total), 0)::text AS items_total FROM order_items WHERE workspace_id = $1 AND order_id = $2",
      [activeWorkspaceId, order.id],
    );
    const orderTotal = Math.max(0, Number(totals.rows[0]!.items_total) + Number(order.delivery_fee) - Number(order.discount));
    await client.query(
      "UPDATE orders SET total_amount = $1, updated_at = now(), version = version + 1 WHERE id = $2 AND workspace_id = $3",
      [orderTotal, order.id, activeWorkspaceId],
    );
    await client.query("COMMIT");

    const item = itemResult.rows[0];
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "create",
      entityType: "order_item",
      entityId: item.id,
      entityLabel: `${variant.product_name} — ${variant.title}`,
      newData: { productVariantId: variant.id, locationId: parsed.data.locationId, quantity: parsed.data.quantity, unitPrice: variant.price, total },
    });
    await publishDomainEvent({
      eventType: "order.item_added",
      entityType: "order",
      entityId: order.id,
      payload: { orderItemId: item.id, productId: variant.product_id, productVariantId: variant.id, locationId: parsed.data.locationId, quantity: parsed.data.quantity, userId },
      sessionUser: req.sessionUser,
    });
    res.status(201).json({ item, orderTotal });
  } catch (error) {
    await client.query("ROLLBACK");
    if (!commerceError(error, res)) throw error;
  } finally {
    client.release();
  }
});

router.patch("/:id/status", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "حالة الطلب غير صحيحة" });
    return;
  }
  if (parsed.data.status === "Cancelled" && !req.sessionUser.permissions.includes("orders:cancel")) {
    res.status(403).json({ error: "ليس لديك صلاحية إلغاء الطلبات", code: "FORBIDDEN" });
    return;
  }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const correlationId = req.id || req.header("x-correlation-id") || crypto.randomUUID();
  try {
    const transition = await transitionOrder({
      workspaceId: activeWorkspaceId,
      orderId: req.params.id as string,
      targetState: parsed.data.status,
      userId,
      correlationId,
      idempotencyKey: parsed.data.idempotencyKey,
      reason: parsed.data.reason,
      reservationExpiresAt: parsed.data.reservationExpiresAt ? new Date(parsed.data.reservationExpiresAt) : null,
    });
    const orderResult = await pool.query(
      `SELECT id, order_number AS "orderNumber", status, payment_status AS "paymentStatus",
              total_amount AS "totalAmount", paid_amount AS "paidAmount", version, updated_at AS "updatedAt"
       FROM orders WHERE id = $1 AND workspace_id = $2`,
      [req.params.id, activeWorkspaceId],
    );
    const order = orderResult.rows[0];
    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      workspaceId: activeWorkspaceId,
      action: "update",
      severity: parsed.data.status === "Cancelled" ? "warning" : "info",
      entityType: "order",
      entityId: req.params.id as string,
      entityLabel: order?.orderNumber,
      oldData: { status: transition.fromState },
      newData: { status: transition.toState, reason: parsed.data.reason, correlationId },
    });
    await publishDomainEvent({
      eventType: "order.status_changed",
      entityType: "order",
      entityId: req.params.id as string,
      payload: { fromState: transition.fromState, toState: transition.toState, reason: parsed.data.reason, correlationId },
      sessionUser: req.sessionUser,
    });
    res.json({ order, transition });
  } catch (error) {
    if (!commerceError(error, res)) throw error;
  }
});

router.get("/:id/reservations", requirePermission("orders:read"), async (req: AuthenticatedRequest, res: Response) => {
  const result = await pool.query(
    `SELECT r.id, r.order_item_id AS "orderItemId", r.product_variant_id AS "productVariantId",
            r.location_id AS "locationId", r.quantity, r.status,
            r.expires_at AS "expiresAt", r.released_at AS "releasedAt", r.consumed_at AS "consumedAt",
            p.name AS "productName", v.title AS "variantTitle", s.name AS "locationName"
     FROM inventory_reservations r
     JOIN product_variants v ON v.id = r.product_variant_id AND v.workspace_id = r.workspace_id
     JOIN inventory_products p ON p.id = v.product_id AND p.workspace_id = r.workspace_id
     JOIN stock_locations s ON s.id = r.location_id AND s.workspace_id = r.workspace_id
     WHERE r.workspace_id = $1 AND r.order_id = $2 ORDER BY r.created_at ASC`,
    [req.sessionUser.activeWorkspaceId, req.params.id],
  );
  res.json({ reservations: result.rows });
});

export default router;
