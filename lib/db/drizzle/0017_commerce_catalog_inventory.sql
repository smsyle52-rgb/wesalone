CREATE TABLE IF NOT EXISTS inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sku text,
  barcode text,
  price numeric(14,2) NOT NULL DEFAULT 0,
  cost numeric(14,2),
  currency text NOT NULL DEFAULT 'YER',
  unit text,
  image_url text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  low_stock_threshold integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  quantity_available integer,
  delivery_policy text NOT NULL DEFAULT 'all',
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS cost numeric(14,2);
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 0;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_inv_products_workspace ON inventory_products(workspace_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_inv_products_status ON inventory_products(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_products_sku ON inventory_products(workspace_id, sku);
CREATE INDEX IF NOT EXISTS idx_inv_products_barcode ON inventory_products(workspace_id, barcode);

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'افتراضي',
  sku text,
  barcode text,
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  price numeric(14,2) NOT NULL DEFAULT 0,
  cost numeric(14,2),
  currency text NOT NULL DEFAULT 'YER',
  low_stock_threshold integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_ws_sku ON product_variants(workspace_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_ws_barcode ON product_variants(workspace_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_ws_product ON product_variants(workspace_id, product_id);

CREATE TABLE IF NOT EXISTS stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'warehouse',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stock_locations_ws_name UNIQUE(workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_stock_locations_ws_active ON stock_locations(workspace_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_locations_one_default ON stock_locations(workspace_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS inventory_stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  incoming integer NOT NULL DEFAULT 0 CHECK (incoming >= 0),
  available integer GENERATED ALWAYS AS (GREATEST(on_hand - reserved, 0)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_inventory_reserved_not_above_on_hand CHECK (reserved <= on_hand),
  CONSTRAINT uq_inventory_level_ws_variant_location UNIQUE(workspace_id, product_variant_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_level_location ON inventory_stock_levels(workspace_id, location_id);
