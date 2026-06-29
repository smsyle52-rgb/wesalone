-- Commerce Safety Stabilization
-- Exact idempotency for order lifecycle commands.

ALTER TABLE order_state_transitions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_state_transitions_ws_order_key
  ON order_state_transitions(workspace_id, order_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
