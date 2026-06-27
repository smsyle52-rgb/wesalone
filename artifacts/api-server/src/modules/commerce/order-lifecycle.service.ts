import { pool } from "@workspace/db";
import { ORDER_TRANSITIONS, type CommerceOrderState, CommerceConflictError } from "./commerce.constants";
import { reserveInventoryForOrder, releaseInventoryForOrder } from "./inventory-reservation.service";
import { consumeInventoryForOrder, returnInventoryForOrder } from "./inventory-consumption.service";

interface TransitionInput {
  workspaceId: string;
  orderId: string;
  targetState: CommerceOrderState;
  userId: string;
  correlationId: string;
  idempotencyKey: string;
  reason?: string;
  reservationExpiresAt?: Date | null;
}

function ensureTransitionAllowed(current: CommerceOrderState, target: CommerceOrderState) {
  const allowed = ORDER_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new CommerceConflictError(
      "INVALID_ORDER_TRANSITION",
      `لا يمكن تغيير حالة الطلب من ${current} إلى ${target}`,
    );
  }
}

async function readOrder(workspaceId: string, orderId: string) {
  const result = await pool.query<{ id: string; status: CommerceOrderState }>(
    "SELECT id, status FROM orders WHERE id = $1 AND workspace_id = $2",
    [orderId, workspaceId],
  );
  const order = result.rows[0];
  if (!order) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");
  return order;
}

async function movementAlreadyRecorded(workspaceId: string, idempotencyPrefix: string) {
  const result = await pool.query(
    `SELECT id FROM inventory_movements
     WHERE workspace_id = $1 AND idempotency_key LIKE $2 LIMIT 1`,
    [workspaceId, `${idempotencyPrefix}:%`],
  );
  return (result.rowCount ?? 0) > 0;
}

async function persistSimpleTransition(
  input: TransitionInput,
  currentState: CommerceOrderState,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ status: CommerceOrderState }>(
      "SELECT status FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [input.orderId, input.workspaceId],
    );
    const current = locked.rows[0]?.status;
    if (!current) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");
    if (current === input.targetState) {
      await client.query("COMMIT");
      return { fromState: current, toState: input.targetState, idempotent: true };
    }
    if (current !== currentState) {
      throw new CommerceConflictError("ORDER_STATE_CHANGED", "تغيّرت حالة الطلب أثناء العملية، أعد المحاولة");
    }
    ensureTransitionAllowed(current, input.targetState);

    const timestampColumn: Partial<Record<CommerceOrderState, string>> = {
      Confirmed: "confirmed_at",
      Reserved: "reserved_at",
      Shipped: "shipped_at",
      Delivered: "delivered_at",
      Cancelled: "cancelled_at",
      Returned: "returned_at",
      Exchanged: "exchanged_at",
    };
    const column = timestampColumn[input.targetState];
    const reasonUpdates: string[] = [];
    const params: unknown[] = [input.targetState, input.orderId, input.workspaceId];
    if (column) reasonUpdates.push(`${column} = now()`);
    if (input.targetState === "Cancelled" && input.reason) {
      params.push(input.reason);
      reasonUpdates.push(`cancel_reason = $${params.length}`);
    }
    if (input.targetState === "Returned" && input.reason) {
      params.push(input.reason);
      reasonUpdates.push(`returned_reason = $${params.length}`);
    }

    await client.query(
      `UPDATE orders
       SET status = $1, version = version + 1, updated_at = now()
       ${reasonUpdates.length ? `, ${reasonUpdates.join(", ")}` : ""}
       WHERE id = $2 AND workspace_id = $3`,
      params,
    );
    await client.query(
      `INSERT INTO order_state_transitions
       (workspace_id, order_id, from_state, to_state, reason, correlation_id, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.workspaceId, input.orderId, current, input.targetState,
        input.reason ?? null, input.correlationId, input.userId],
    );
    await client.query("COMMIT");
    return { fromState: current, toState: input.targetState, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function transitionOrder(input: TransitionInput) {
  const order = await readOrder(input.workspaceId, input.orderId);
  if (order.status === input.targetState) {
    return { fromState: order.status, toState: input.targetState, idempotent: true };
  }
  ensureTransitionAllowed(order.status, input.targetState);

  if (input.targetState === "Reserved") {
    const reservation = await reserveInventoryForOrder({
      workspaceId: input.workspaceId,
      orderId: input.orderId,
      userId: input.userId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.reservationExpiresAt,
    });
    return { fromState: order.status, toState: "Reserved" as const, inventory: reservation };
  }

  if (input.targetState === "Cancelled" && ["Reserved", "Preparing", "Ready"].includes(order.status)) {
    await releaseInventoryForOrder({
      workspaceId: input.workspaceId,
      orderId: input.orderId,
      userId: input.userId,
      correlationId: input.correlationId,
      idempotencyKey: `release:${input.idempotencyKey}`,
      movementType: "Cancellation",
      reason: input.reason?.trim() || "إلغاء الطلب",
    });
  }

  if (input.targetState === "Delivered") {
    const saleKey = `sale:${input.idempotencyKey}`;
    if (!(await movementAlreadyRecorded(input.workspaceId, saleKey))) {
      await consumeInventoryForOrder({
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        userId: input.userId,
        correlationId: input.correlationId,
        idempotencyKey: saleKey,
      });
    }
  }

  if (input.targetState === "Returned" || input.targetState === "Exchanged") {
    if (!input.reason?.trim()) {
      throw new CommerceConflictError("RETURN_REASON_REQUIRED", "سبب الإرجاع أو الاستبدال مطلوب");
    }
    const returnKey = `return:${input.idempotencyKey}`;
    if (!(await movementAlreadyRecorded(input.workspaceId, returnKey))) {
      await returnInventoryForOrder({
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        userId: input.userId,
        correlationId: input.correlationId,
        idempotencyKey: returnKey,
      });
    }
  }

  return persistSimpleTransition(input, order.status);
}
