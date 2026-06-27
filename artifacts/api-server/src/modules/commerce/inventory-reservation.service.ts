import { pool } from "@workspace/db";
import { CommerceConflictError } from "./commerce.constants";

interface ReserveInput {
  workspaceId: string;
  orderId: string;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
  expiresAt?: Date | null;
}

interface ReleaseInput {
  workspaceId: string;
  orderId: string;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
  movementType?: "Release" | "Cancellation";
  reason: string;
}

interface LockedOrderItem {
  id: string;
  product_variant_id: string | null;
  location_id: string | null;
  quantity: number;
}

export async function reserveInventoryForOrder(input: ReserveInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [input.orderId, input.workspaceId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");

    const previous = await client.query(
      "SELECT id FROM inventory_reservations WHERE workspace_id = $1 AND order_id = $2 AND idempotency_key LIKE $3 LIMIT 1",
      [input.workspaceId, input.orderId, `${input.idempotencyKey}:%`],
    );
    if (previous.rowCount) {
      await client.query("COMMIT");
      return { idempotent: true };
    }

    const itemsResult = await client.query<LockedOrderItem>(
      `SELECT id, product_variant_id, location_id, quantity
       FROM order_items
       WHERE workspace_id = $1 AND order_id = $2
       ORDER BY product_variant_id, location_id, id`,
      [input.workspaceId, input.orderId],
    );
    if (itemsResult.rows.length === 0) {
      throw new CommerceConflictError("EMPTY_ORDER", "لا يمكن حجز مخزون لطلب بلا بنود");
    }

    const lockedLevels = new Map<string, { id: string; onHand: number; reserved: number }>();
    for (const item of itemsResult.rows) {
      if (!item.product_variant_id || !item.location_id) {
        throw new CommerceConflictError("ITEM_NOT_STOCK_LINKED", "كل بند يجب أن يرتبط بمتغير وموقع مخزون");
      }
      const key = `${item.product_variant_id}:${item.location_id}`;
      if (!lockedLevels.has(key)) {
        const levelResult = await client.query<{ id: string; on_hand: number; reserved: number }>(
          `SELECT id, on_hand, reserved FROM inventory_stock_levels
           WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3
           FOR UPDATE`,
          [input.workspaceId, item.product_variant_id, item.location_id],
        );
        const level = levelResult.rows[0];
        if (!level) throw new CommerceConflictError("STOCK_LEVEL_NOT_FOUND", "سجل المخزون غير موجود للمتغير والموقع");
        lockedLevels.set(key, { id: level.id, onHand: level.on_hand, reserved: level.reserved });
      }
      const level = lockedLevels.get(key)!;
      const available = level.onHand - level.reserved;
      if (available < item.quantity) {
        throw new CommerceConflictError("INSUFFICIENT_STOCK", `الكمية المتاحة ${available} فقط`);
      }
      level.reserved += item.quantity;
    }

    const reservations: Array<{ id: string }> = [];
    for (const item of itemsResult.rows) {
      const itemKey = `${input.idempotencyKey}:${item.id}`;
      const reservationResult = await client.query<{ id: string }>(
        `INSERT INTO inventory_reservations
         (workspace_id, order_id, order_item_id, product_variant_id, location_id, quantity, status,
          expires_at, created_by, correlation_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)
         RETURNING id`,
        [input.workspaceId, input.orderId, item.id, item.product_variant_id, item.location_id,
          item.quantity, input.expiresAt ?? null, input.userId, input.correlationId, itemKey],
      );
      const reservation = reservationResult.rows[0]!;
      reservations.push(reservation);
      await client.query(
        `UPDATE inventory_stock_levels
         SET reserved = reserved + $1, updated_at = now()
         WHERE workspace_id = $2 AND product_variant_id = $3 AND location_id = $4`,
        [item.quantity, input.workspaceId, item.product_variant_id, item.location_id],
      );
      await client.query(
        `INSERT INTO inventory_movements
         (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
          order_id, order_item_id, reservation_id, created_by, correlation_id, idempotency_key)
         VALUES ($1,$2,$3,$4,'Reservation','حجز مخزون للطلب',$5,$6,$7,$8,$9,$10)`,
        [input.workspaceId, item.product_variant_id, item.location_id, item.quantity,
          input.orderId, item.id, reservation.id, input.userId, input.correlationId, `movement:${itemKey}`],
      );
      await client.query(
        "UPDATE order_items SET reservation_status = 'reserved', updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [item.id, input.workspaceId],
      );
    }

    await client.query(
      "UPDATE orders SET status = 'Reserved', reserved_at = now(), version = version + 1, updated_at = now() WHERE id = $1 AND workspace_id = $2",
      [input.orderId, input.workspaceId],
    );
    if (order.status !== "Reserved") {
      await client.query(
        `INSERT INTO order_state_transitions
         (workspace_id, order_id, from_state, to_state, correlation_id, changed_by)
         VALUES ($1,$2,$3,'Reserved',$4,$5)`,
        [input.workspaceId, input.orderId, order.status, input.correlationId, input.userId],
      );
    }
    await client.query("COMMIT");
    return { idempotent: false, reservations };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseInventoryForOrder(input: ReleaseInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservations = await client.query<{
      id: string; order_item_id: string; product_variant_id: string; location_id: string; quantity: number;
    }>(
      `SELECT id, order_item_id, product_variant_id, location_id, quantity
       FROM inventory_reservations
       WHERE workspace_id = $1 AND order_id = $2 AND status = 'active'
       ORDER BY product_variant_id, location_id, id FOR UPDATE`,
      [input.workspaceId, input.orderId],
    );

    for (const reservation of reservations.rows) {
      await client.query(
        `SELECT id FROM inventory_stock_levels
         WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3 FOR UPDATE`,
        [input.workspaceId, reservation.product_variant_id, reservation.location_id],
      );
      await client.query(
        `UPDATE inventory_stock_levels SET reserved = GREATEST(reserved - $1, 0), updated_at = now()
         WHERE workspace_id = $2 AND product_variant_id = $3 AND location_id = $4`,
        [reservation.quantity, input.workspaceId, reservation.product_variant_id, reservation.location_id],
      );
      await client.query(
        `UPDATE inventory_reservations SET status = 'released', released_at = now(), updated_at = now()
         WHERE id = $1 AND workspace_id = $2`,
        [reservation.id, input.workspaceId],
      );
      await client.query(
        `INSERT INTO inventory_movements
         (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
          order_id, order_item_id, reservation_id, created_by, correlation_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [input.workspaceId, reservation.product_variant_id, reservation.location_id, reservation.quantity,
          input.movementType ?? "Release", input.reason, input.orderId, reservation.order_item_id,
          reservation.id, input.userId, input.correlationId, `${input.idempotencyKey}:${reservation.id}`],
      );
      await client.query(
        "UPDATE order_items SET reservation_status = 'released', updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [reservation.order_item_id, input.workspaceId],
      );
    }
    await client.query("COMMIT");
    return { released: reservations.rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function expireInventoryReservations(workspaceId: string, userId: string) {
  const result = await pool.query<{ order_id: string }>(
    `SELECT DISTINCT order_id FROM inventory_reservations
     WHERE workspace_id = $1 AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
     LIMIT 100`,
    [workspaceId],
  );
  for (const row of result.rows) {
    await releaseInventoryForOrder({
      workspaceId,
      orderId: row.order_id,
      userId,
      correlationId: `expiry:${row.order_id}`,
      idempotencyKey: `expiry:${row.order_id}`,
      reason: "انتهاء مهلة الحجز",
    });
  }
  return { expiredOrders: result.rows.length };
}
