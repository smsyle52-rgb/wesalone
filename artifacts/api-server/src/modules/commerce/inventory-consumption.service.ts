import { pool } from "@workspace/db";
import type { PoolClient } from "../../types/database-client";
import { CommerceConflictError } from "./commerce.constants";

interface InventoryOperationContext {
  workspaceId: string;
  orderId: string;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
}

interface AdjustmentInput {
  workspaceId: string;
  productVariantId: string;
  locationId: string;
  adjustment: number;
  reason: string;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
  movementType?: "Initial" | "Adjustment" | "Incoming" | "Damage";
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

function aggregateReservations(rows: ReservationRow[]) {
  const aggregates = new Map<string, StockAggregate>();
  for (const row of rows) {
    const key = `${row.product_variant_id}:${row.location_id}`;
    const current = aggregates.get(key);
    if (current) current.quantity += row.quantity;
    else aggregates.set(key, {
      productVariantId: row.product_variant_id,
      locationId: row.location_id,
      quantity: row.quantity,
    });
  }
  return [...aggregates.values()].sort((a, b) =>
    `${a.productVariantId}:${a.locationId}`.localeCompare(`${b.productVariantId}:${b.locationId}`),
  );
}

export async function consumeInventoryForOrder(client: PoolClient, input: InventoryOperationContext) {
  const reservations = await client.query<ReservationRow>(
    `SELECT id, order_item_id, product_variant_id, location_id, quantity
     FROM inventory_reservations
     WHERE workspace_id = $1 AND order_id = $2 AND status = 'active'
     ORDER BY product_variant_id, location_id, id
     FOR UPDATE`,
    [input.workspaceId, input.orderId],
  );
  if (!reservations.rowCount) {
    throw new CommerceConflictError("NO_ACTIVE_RESERVATION", "لا يوجد حجز نشط يمكن استهلاكه لهذا الطلب");
  }

  const aggregates = aggregateReservations(reservations.rows);
  for (const aggregate of aggregates) {
    const level = await client.query<{ on_hand: number; reserved: number }>(
      `SELECT on_hand, reserved FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3
       FOR UPDATE`,
      [input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
    const stock = level.rows[0];
    if (!stock || stock.on_hand < aggregate.quantity || stock.reserved < aggregate.quantity) {
      throw new CommerceConflictError("STOCK_INVARIANT_BROKEN", "تعذر تنفيذ البيع بسبب عدم تطابق رصيد الحجز");
    }
  }

  for (const aggregate of aggregates) {
    await client.query(
      `UPDATE inventory_stock_levels
       SET on_hand = on_hand - $1, reserved = reserved - $1, updated_at = now()
       WHERE workspace_id = $2 AND product_variant_id = $3 AND location_id = $4`,
      [aggregate.quantity, input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
  }

  for (const reservation of reservations.rows) {
    await client.query(
      `UPDATE inventory_reservations
       SET status = 'consumed', consumed_at = now(), updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [reservation.id, input.workspaceId],
    );
    await client.query(
      `UPDATE order_items SET reservation_status = 'consumed', updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [reservation.order_item_id, input.workspaceId],
    );
    await client.query(
      `INSERT INTO inventory_movements
       (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
        order_id, order_item_id, reservation_id, created_by, correlation_id, idempotency_key)
       VALUES ($1,$2,$3,$4,'Sale','تنفيذ بيع الطلب',$5,$6,$7,$8,$9,$10)`,
      [input.workspaceId, reservation.product_variant_id, reservation.location_id,
        -reservation.quantity, input.orderId, reservation.order_item_id, reservation.id,
        input.userId, input.correlationId, `${input.idempotencyKey}:${reservation.id}`],
    );
  }

  return { idempotent: false, consumed: reservations.rows.length };
}

export async function returnInventoryForOrder(client: PoolClient, input: InventoryOperationContext) {
  const consumed = await client.query<ReservationRow>(
    `SELECT id, order_item_id, product_variant_id, location_id, quantity
     FROM inventory_reservations
     WHERE workspace_id = $1 AND order_id = $2 AND status = 'consumed'
     ORDER BY product_variant_id, location_id, id
     FOR UPDATE`,
    [input.workspaceId, input.orderId],
  );
  if (!consumed.rowCount) {
    throw new CommerceConflictError("NO_CONSUMED_RESERVATION", "لا توجد كمية مباعة قابلة للإرجاع");
  }

  const movementKeys = consumed.rows.map((reservation) => `${input.idempotencyKey}:${reservation.id}`);
  const prior = await client.query(
    `SELECT id FROM inventory_movements
     WHERE workspace_id = $1 AND idempotency_key = ANY($2::text[])`,
    [input.workspaceId, movementKeys],
  );
  if ((prior.rowCount ?? 0) > 0) {
    throw new CommerceConflictError("IDEMPOTENCY_PARTIAL_STATE", "حالة idempotency غير مكتملة للإرجاع");
  }

  const aggregates = aggregateReservations(consumed.rows);
  for (const aggregate of aggregates) {
    const level = await client.query<{ id: string }>(
      `SELECT id FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3
       FOR UPDATE`,
      [input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
    if (!level.rows[0]) throw new CommerceConflictError("STOCK_LEVEL_NOT_FOUND", "سجل المخزون غير موجود");
  }

  for (const aggregate of aggregates) {
    await client.query(
      `UPDATE inventory_stock_levels SET on_hand = on_hand + $1, updated_at = now()
       WHERE workspace_id = $2 AND product_variant_id = $3 AND location_id = $4`,
      [aggregate.quantity, input.workspaceId, aggregate.productVariantId, aggregate.locationId],
    );
  }

  for (const reservation of consumed.rows) {
    const movementKey = `${input.idempotencyKey}:${reservation.id}`;
    await client.query(
      `UPDATE inventory_reservations SET status = 'returned', updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [reservation.id, input.workspaceId],
    );
    await client.query(
      `UPDATE order_items SET reservation_status = 'returned', updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [reservation.order_item_id, input.workspaceId],
    );
    await client.query(
      `INSERT INTO inventory_movements
       (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
        order_id, order_item_id, reservation_id, created_by, correlation_id, idempotency_key)
       VALUES ($1,$2,$3,$4,'Return','إرجاع منتج من الطلب',$5,$6,$7,$8,$9,$10)`,
      [input.workspaceId, reservation.product_variant_id, reservation.location_id,
        reservation.quantity, input.orderId, reservation.order_item_id, reservation.id,
        input.userId, input.correlationId, movementKey],
    );
  }

  return { idempotent: false, returned: consumed.rows.length };
}

export async function adjustInventory(input: AdjustmentInput) {
  if (!Number.isInteger(input.adjustment) || input.adjustment === 0) {
    throw new CommerceConflictError("INVALID_ADJUSTMENT", "تعديل المخزون يجب أن يكون عددًا صحيحًا غير صفر");
  }
  if (!input.reason.trim()) {
    throw new CommerceConflictError("REASON_REQUIRED", "سبب تعديل المخزون مطلوب");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const levelResult = await client.query<{ id: string; on_hand: number; reserved: number }>(
      `SELECT id, on_hand, reserved FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3 FOR UPDATE`,
      [input.workspaceId, input.productVariantId, input.locationId],
    );
    const level = levelResult.rows[0];
    if (!level) throw new CommerceConflictError("STOCK_LEVEL_NOT_FOUND", "سجل المخزون غير موجود");

    const prior = await client.query(
      "SELECT id FROM inventory_movements WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1",
      [input.workspaceId, input.idempotencyKey],
    );
    if (prior.rowCount) {
      await client.query("COMMIT");
      return { idempotent: true };
    }

    const nextOnHand = level.on_hand + input.adjustment;
    if (nextOnHand < 0 || nextOnHand < level.reserved) {
      throw new CommerceConflictError("INVALID_STOCK_BALANCE", "لا يمكن أن يصبح الرصيد أقل من الصفر أو أقل من الكمية المحجوزة");
    }

    await client.query(
      `UPDATE inventory_stock_levels SET on_hand = $1, updated_at = now()
       WHERE id = $2 AND workspace_id = $3`,
      [nextOnHand, level.id, input.workspaceId],
    );
    await client.query(
      `INSERT INTO inventory_movements
       (workspace_id, product_variant_id, location_id, quantity, movement_type, reason,
        created_by, correlation_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [input.workspaceId, input.productVariantId, input.locationId, input.adjustment,
        input.movementType ?? "Adjustment", input.reason.trim(), input.userId,
        input.correlationId, input.idempotencyKey],
    );
    await client.query("COMMIT");
    return { idempotent: false, onHand: nextOnHand, reserved: level.reserved, available: nextOnHand - level.reserved };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
