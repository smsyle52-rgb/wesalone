import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { ORDER_TRANSITIONS, type CommerceOrderState, CommerceConflictError } from "./commerce.constants";
import { transitionOrder } from "./order-lifecycle.service";

const router = Router();
router.use(requireSession);

const itemUpdateSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  discount: z.number().min(0).optional(),
  description: z.string().max(1000).optional().nullable(),
});

async function recalculateOrder(client: import("pg").PoolClient, workspaceId: string, orderId: string) {
  const result = await client.query<{ items_total: string; discount: string; delivery_fee: string }>(
    `SELECT COALESCE(SUM(i.total), 0)::text AS items_total,
            MAX(o.discount)::text AS discount, MAX(o.delivery_fee)::text AS delivery_fee
     FROM orders o LEFT JOIN order_items i
       ON i.workspace_id = o.workspace_id AND i.order_id = o.id
     WHERE o.workspace_id = $1 AND o.id = $2 GROUP BY o.id`,
    [workspaceId, orderId],
  );
  const row = result.rows[0];
  if (!row) return "0";
  const total = Math.max(0, Number(row.items_total) + Number(row.delivery_fee) - Number(row.discount));
  await client.query(
    "UPDATE orders SET total_amount = $1, version = version + 1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
    [total.toFixed(2), orderId, workspaceId],
  );
  return total.toFixed(2);
}

router.patch("/orders/:id/items/:itemId", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = itemUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات البند غير صحيحة" });
    return;
  }
  const workspaceId = req.sessionUser.activeWorkspaceId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{ status: CommerceOrderState }>(
      "SELECT status FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [req.params.id, workspaceId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");
    if (!["Draft", "AwaitingConfirmation"].includes(order.status)) {
      throw new CommerceConflictError("ORDER_ITEMS_LOCKED", "لا يمكن تعديل البنود بعد تأكيد الطلب");
    }
    const itemResult = await client.query<{
      id: string; product_variant_id: string | null; quantity: number; discount: string; tax: string;
    }>(
      `SELECT id, product_variant_id, quantity, discount, tax FROM order_items
       WHERE id = $1 AND order_id = $2 AND workspace_id = $3 FOR UPDATE`,
      [req.params.itemId, req.params.id, workspaceId],
    );
    const item = itemResult.rows[0];
    if (!item?.product_variant_id) {
      throw new CommerceConflictError("CATALOG_ITEM_REQUIRED", "البند غير مرتبط بمتغير منتج حقيقي");
    }
    const variantResult = await client.query<{ price: string; title: string }>(
      "SELECT price, title FROM product_variants WHERE id = $1 AND workspace_id = $2 AND status = 'active'",
      [item.product_variant_id, workspaceId],
    );
    const variant = variantResult.rows[0];
    if (!variant) throw new CommerceConflictError("VARIANT_NOT_AVAILABLE", "متغير المنتج غير متاح");
    const quantity = parsed.data.quantity ?? item.quantity;
    const discount = parsed.data.discount ?? Number(item.discount);
    const subtotal = quantity * Number(variant.price);
    if (discount > subtotal) throw new CommerceConflictError("INVALID_DISCOUNT", "الخصم أكبر من قيمة البند");
    const total = subtotal - discount + Number(item.tax);
    const updated = await client.query(
      `UPDATE order_items SET quantity = $1, unit_price = $2, discount = $3, total = $4,
              description = COALESCE($5, description), updated_at = now()
       WHERE id = $6 AND order_id = $7 AND workspace_id = $8 RETURNING *`,
      [quantity, variant.price, discount, total, parsed.data.description ?? null,
        req.params.itemId, req.params.id, workspaceId],
    );
    const orderTotal = await recalculateOrder(client, workspaceId, req.params.id as string);
    await client.query("COMMIT");
    res.json({ item: updated.rows[0], orderTotal });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof CommerceConflictError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.delete("/orders/:id/items/:itemId", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.sessionUser.activeWorkspaceId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{ status: CommerceOrderState }>(
      "SELECT status FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [req.params.id, workspaceId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");
    if (!["Draft", "AwaitingConfirmation"].includes(order.status)) {
      throw new CommerceConflictError("ORDER_ITEMS_LOCKED", "لا يمكن حذف البنود بعد تأكيد الطلب");
    }
    const deleted = await client.query(
      "DELETE FROM order_items WHERE id = $1 AND order_id = $2 AND workspace_id = $3 RETURNING id",
      [req.params.itemId, req.params.id, workspaceId],
    );
    if (!deleted.rowCount) throw new CommerceConflictError("ORDER_ITEM_NOT_FOUND", "البند غير موجود");
    const orderTotal = await recalculateOrder(client, workspaceId, req.params.id as string);
    await client.query("COMMIT");
    res.json({ success: true, orderTotal });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof CommerceConflictError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

const deliverySchema = z.object({
  deliveryStatus: z.enum(["preparing", "ready", "out_for_delivery", "handed_to_carrier", "delivered"]),
});

function pathToDelivered(from: CommerceOrderState) {
  if (from === "Delivered") return [] as CommerceOrderState[];
  const queue: Array<{ state: CommerceOrderState; path: CommerceOrderState[] }> = [{ state: from, path: [] }];
  const visited = new Set<CommerceOrderState>([from]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of ORDER_TRANSITIONS[current.state] ?? []) {
      if (next === "Cancelled" || next === "Returned" || next === "Exchanged" || visited.has(next)) continue;
      const path = [...current.path, next];
      if (next === "Delivered") return path;
      visited.add(next);
      queue.push({ state: next, path });
    }
  }
  return null;
}

router.patch("/orders/:id/delivery-status", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = deliverySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "حالة التوصيل غير صحيحة" });
    return;
  }
  const workspaceId = req.sessionUser.activeWorkspaceId;
  const existing = await pool.query<{ status: CommerceOrderState; delivery_type: string }>(
    "SELECT status, delivery_type FROM orders WHERE id = $1 AND workspace_id = $2",
    [req.params.id, workspaceId],
  );
  const order = existing.rows[0];
  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }
  if (order.delivery_type === "pickup") {
    res.status(409).json({ error: "طلب الاستلام من المحل لا يملك دورة توصيل" });
    return;
  }
  const key = req.id || crypto.randomUUID();
  try {
    if (parsed.data.deliveryStatus === "delivered" && order.status !== "Delivered") {
      const path = pathToDelivered(order.status);
      if (!path) throw new CommerceConflictError("INVALID_ORDER_TRANSITION", "لا يمكن إكمال تسليم هذا الطلب");
      for (let index = 0; index < path.length; index += 1) {
        await transitionOrder({
          workspaceId,
          orderId: req.params.id as string,
          targetState: path[index]!,
          userId: req.sessionUser.userId,
          correlationId: key,
          idempotencyKey: `${key}:delivery:${index}`,
        });
      }
    }
    const updated = await pool.query(
      `UPDATE orders SET delivery_status = $1, updated_at = now()
       WHERE id = $2 AND workspace_id = $3 RETURNING id, status, delivery_status AS "deliveryStatus"`,
      [parsed.data.deliveryStatus, req.params.id, workspaceId],
    );
    res.json({ order: updated.rows[0] });
  } catch (error) {
    if (error instanceof CommerceConflictError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
});

export default router;
