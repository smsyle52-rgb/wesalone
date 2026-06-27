import { pool } from "@workspace/db";
import { ORDER_TRANSITIONS, type CommerceOrderState, CommerceConflictError } from "./commerce.constants";
import { reserveInventoryForOrder, releaseInventoryForOrder } from "./inventory-reservation.service";
import { consumeInventoryForOrder, returnInventoryForOrder } from "./inventory-consumption.service";

interface TransitionInput {
  workspaceId: string;
  orderId: string;
  targetState: CommerceOrderState;
  userId: string;
  correlationId: unknown;
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

export async function transitionOrder(input: TransitionInput) {
  const client = await pool.connect();
  const correlationId = input.correlationId == null ? crypto.randomUUID() : String(input.correlationId);
  try {
    await client.query("BEGIN");

    const locked = await client.query<{ status: CommerceOrderState }>(
      "SELECT status FROM orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
      [input.orderId, input.workspaceId],
    );
    const current = locked.rows[0]?.status;
    if (!current) throw new CommerceConflictError("ORDER_NOT_FOUND", "الطلب غير موجود");

    const prior = await client.query<{ from_state: CommerceOrderState; to_state: CommerceOrderState }>(
      `SELECT from_state, to_state
       FROM order_state_transitions
       WHERE workspace_id = $1 AND order_id = $2 AND idempotency_key = $3
       LIMIT 1`,
      [input.workspaceId, input.orderId, input.idempotencyKey],
    );
    const priorTransition = prior.rows[0];
    if (priorTransition) {
      if (priorTransition.to_state !== input.targetState) {
        throw new CommerceConflictError(
          "IDEMPOTENCY_KEY_REUSED",
          "تم استخدام مفتاح idempotency نفسه لانتقال مختلف",
        );
      }
      await client.query("COMMIT");
      return {
        fromState: priorTransition.from_state,
        toState: priorTransition.to_state,
        idempotent: true,
      };
    }

    if (current === input.targetState) {
      await client.query("COMMIT");
      return { fromState: current, toState: input.targetState, idempotent: true };
    }

    ensureTransitionAllowed(current, input.targetState);
    if ((input.targetState === "Returned" || input.targetState === "Exchanged") && !input.reason?.trim()) {
      throw new CommerceConflictError("RETURN_REASON_REQUIRED", "سبب الإرجاع أو الاستبدال مطلوب");
    }

    let inventory: unknown;
    if (input.targetState === "Reserved") {
      inventory = await reserveInventoryForOrder(client, {
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        userId: input.userId,
        correlationId,
        idempotencyKey: `reserve:${input.idempotencyKey}`,
        expiresAt: input.reservationExpiresAt,
      });
    } else if (input.targetState === "Cancelled" && ["Reserved", "Preparing", "Ready"].includes(current)) {
      inventory = await releaseInventoryForOrder(client, {
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        userId: input.userId,
        correlationId,
        idempotencyKey: `release:${input.idempotencyKey}`,
        movementType: "Cancellation",
        reason: input.reason?.trim() || "إلغاء الطلب",
      });
    } else if (input.targetState === "Delivered") {
      inventory = await consumeInventoryForOrder(client, {
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        userId: input.userId,
        correlationId,
        idempotencyKey: `sale:${input.idempotencyKey}`,
      });
    } else if (input.targetState === "Returned" || (input.targetState === "Exchanged" && current !== "Returned")) {
      inventory = await returnInventoryForOrder(client, {
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        userId: input.userId,
        correlationId,
        idempotencyKey: `return:${input.idempotencyKey}`,
      });
    }

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
    const additionalUpdates: string[] = [];
    const params: unknown[] = [input.targetState, input.orderId, input.workspaceId];
    if (column) additionalUpdates.push(`${column} = now()`);
    if (input.targetState === "Cancelled" && input.reason) {
      params.push(input.reason);
      additionalUpdates.push(`cancel_reason = $${params.length}`);
    }
    if (input.targetState === "Returned" && input.reason) {
      params.push(input.reason);
      additionalUpdates.push(`returned_reason = $${params.length}`);
    }

    await client.query(
      `UPDATE orders
       SET status = $1, version = version + 1, updated_at = now()
       ${additionalUpdates.length ? `, ${additionalUpdates.join(", ")}` : ""}
       WHERE id = $2 AND workspace_id = $3`,
      params,
    );
    await client.query(
      `INSERT INTO order_state_transitions
       (workspace_id, order_id, from_state, to_state, reason, correlation_id, idempotency_key, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.workspaceId, input.orderId, current, input.targetState,
        input.reason ?? null, correlationId, input.idempotencyKey, input.userId],
    );

    await client.query("COMMIT");
    return { fromState: current, toState: input.targetState, idempotent: false, inventory };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
