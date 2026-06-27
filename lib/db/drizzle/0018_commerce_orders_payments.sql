ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inventory_product_id uuid REFERENCES inventory_products(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES stock_locations(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS reservation_status text NOT NULL DEFAULT 'none';
ALTER TABLE order_items ALTER COLUMN unit_price TYPE numeric(14,2);
ALTER TABLE order_items ALTER COLUMN total TYPE numeric(14,2);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS exchanged_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'pickup';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_agent_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_receipt_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE orders ALTER COLUMN total_amount TYPE numeric(14,2);
ALTER TABLE orders ALTER COLUMN paid_amount TYPE numeric(14,2);
ALTER TABLE orders ALTER COLUMN discount TYPE numeric(14,2);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_reference text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_url text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE payments ALTER COLUMN amount TYPE numeric(14,2);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_ws_idempotency ON payments(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_variant_id uuid NOT NULL REFERENCES product_variants(id),
  location_id uuid NOT NULL REFERENCES stock_locations(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  released_at timestamptz,
  consumed_at timestamptz,
  created_by uuid REFERENCES users(id),
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_inventory_reservations_ws_key UNIQUE(workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order ON inventory_reservations(workspace_id, order_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expiry ON inventory_reservations(workspace_id, status, expires_at);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_variant_id uuid NOT NULL REFERENCES product_variants(id),
  location_id uuid NOT NULL REFERENCES stock_locations(id),
  quantity integer NOT NULL CHECK (quantity <> 0),
  movement_type text NOT NULL,
  reason text NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES inventory_reservations(id) ON DELETE SET NULL,
  destination_location_id uuid REFERENCES stock_locations(id),
  created_by uuid REFERENCES users(id),
  correlation_id text NOT NULL,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant ON inventory_movements(workspace_id, product_variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON inventory_movements(workspace_id, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_ws_key ON inventory_movements(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_state_transitions_order ON order_state_transitions(workspace_id, order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'YER',
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  external_reference text,
  recorded_by uuid REFERENCES users(id),
  verified_by uuid REFERENCES users(id),
  refunded_at timestamptz,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_refunds_ws_key UNIQUE(workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON payment_refunds(workspace_id, payment_id);

CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory movements are immutable; create a reversing movement';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inventory_movements_immutable ON inventory_movements;
CREATE TRIGGER inventory_movements_immutable BEFORE UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();
