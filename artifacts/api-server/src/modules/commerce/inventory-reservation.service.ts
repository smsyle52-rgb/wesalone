import { pool } from "@workspace/db";
import type { PoolClient } from "../../types/database-client";
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

interface ReservationRow {
  id: string;
  order_item_id: string;
  product_variant_id: string;
  location_id: string;
  quantity: number;
}

interface StockAggregate {
  productVariantId: string;
  locationId: string;
  quantity: number;
}

function aggregateStockRows(rows: Array<{ product_variant_id: string; location_id: string; quantity: number }>) {
  const aggregates = new Map<string, StockAggregate>();
  for (const row of rows) {
    const key = `${row.product_variant_id}:${row.location_id}`;
    const current = aggregates.get(key);
    if (current) {
      current.quantity += row.quantity;
    } else {
      aggregates.set(key, {
        productVariantId: row.product_variant_id,
        locationId: row.location_id,
        quantity: row.quantity,
      });
    }
  }
  return [...aggregates.values()].sort((a, b) =>
    `${a.productVariantId}:${a.locationId}`.localeCompare(`${b.productVariantId}:${b.locationId}`),
  );
}

export async function reserveInventoryForOrder(client: PoolClient, input: ReserveInput) {
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

  for (const item of itemsResult.rows) {
    if (!item.product_variant_id || !item.location_id) {
      throw new CommerceConflictError("ITEM_NOT_STOCK_LINKED", "كل بند يجب أن يرتبط بمتغير وموقع مخزون");
    }
  }

  const itemKeys = itemsResult.rows.map((item) => `${input.idempotencyKey}:${item.id}`);
  const prior = await client.query<{ idempotency_key: string }>(
    `SELECT idempotency_key
     FROM inventory_reservations
     WHERE workspace_id = $1 AND order_id = $2 AND idempotency_key = ANY($3::text[])`,
    [input.workspaceId, input.orderId, itemKeys],
  );
  if ((prior.rowCount ?? 0) > 0) {
    if (prior.rowCount === itemKeys.length) return { idempotent: true, reservations: [] as Array<{ id: string }> };
    throw new CommerceConflictError("IDEMPOTENCY_PARTIAL_STATE", "حالة idempotency غير مكتملة للحجز");
  }

  const linkedItems = itemsResult.rows as Array<LockedOrderItem & { product_variant_id: string; location_id: string }>;
  const aggregates = aggregateStockRows(linkedItems);
  for (const aggregate of aggregates) {
    const levelResult = await client.query<{ id: string; on_hand: number; reserved: number }>(
      `SELECT id, on_hand, reserved FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3
       FOR UPDATE`,
      [input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
    const level = levelResult.rows[0];
    if (!level) throw new CommerceConflictError("STOCK_LEVEL_NOT_FOUND", "سجل المخزون غير موجود للمتغير والموقع");
    const available = level.on_hand - level.reserved;
    if (available < aggregate.quantity) {
      throw new CommerceConflictError("INSUFFICIENT_STOCK", `الكمية المتاحة ${available} فقط`);
    }
  }

  for (const aggregate of aggregates) {
    await client.query(
      `UPDATE inventory_stock_levels
       SET reserved = reserved + $1, updated_at = now()
       WHERE workspace_id = $2 AND product_variant_id = $3 AND location_id = $4`,
      [aggregate.quantity, input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
  }

  const reservations: Array<{ id: string }> = [];
  for (const item of linkedItems) {
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

  return { idempotent: false, reservations };
}

export async function releaseInventoryForOrder(client: PoolClient, input: ReleaseInput) {
  const reservations = await client.query<ReservationRow>(
    `SELECT id, order_item_id, product_variant_id, location_id, quantity
     FROM inventory_reservations
     WHERE workspace_id = $1 AND order_id = $2 AND status = 'active'
     ORDER BY product_variant_id, location_id, id FOR UPDATE`,
    [input.workspaceId, input.orderId],
  );

  if (!reservations.rowCount) return { released: 0, idempotent: true };

  const aggregates = aggregateStockRows(reservations.rows);
  for (const aggregate of aggregates) {
    const levelResult = await client.query<{ id: string; reserved: number }>(
      `SELECT id, reserved FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3 FOR UPDATE`,
      [input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
    const level = levelResult.rows[0];
    if (!level || level.reserved < aggregate.quantity) {
      throw new CommerceConflictError("STOCK_INVARIANT_BROKEN", "تعذر تحرير الحجز بسبب عدم تطابق رصيد المخزون");
    }
  }

  for (const aggregate of aggregates) {
    await client.query(
      `UPDATE inventory_stock_levels SET reserved = reserved - $1, updated_at = now()
       WHERE workspace_id = $2 AND product_variant_id = $3 AND location_id = $4`,
      [aggregate.quantity, input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
  }

  for (const reservation of reservations.rows) {
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

  return { released: reservations.rows.length, idempotent: false };
}

export async function expireInventoryReservations(workspaceId: string, userId: string) {
  const result = await pool.query<{ order_id: string }>(
    `SELECT DISTINCT order_id FROM inventory_reservations
     WHERE workspace_id = $1 AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
     LIMIT 100`,
    [workspaceId],
  );
  for (const row of result.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [row.order_id, workspaceId],
      );
      await releaseInventoryForOrder(client, {
        workspaceId,
        orderId: row.order_id,
        userId,
        correlationId: `expiry:${row.order_id}`,
        idempotencyKey: `expiry:${row.order_id}`,
        reason: "انتهاء مهلة الحجز",
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return { expiredOrders: result.rows.length };
}
