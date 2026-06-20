-- نطاق المخزون: جدول المنتجات الداخلي (inventory_products) وربطه ببنود الطلبات.
-- مختلف عن جدول products (كتالوج ميتا المتزامن).
-- idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS — آمن للتطبيق على الإنتاج قبل النشر.

CREATE TABLE IF NOT EXISTS inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sku text,
  price numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'YER',
  unit text,
  image_url text,
  quantity_available integer,
  delivery_policy text NOT NULL DEFAULT 'all',
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_products_workspace ON inventory_products(workspace_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_inv_products_sku ON inventory_products(workspace_id, sku);

-- inventory_product_id على order_items: مرجع اختياري للمنتج من المخزون الداخلي
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inventory_product_id uuid REFERENCES inventory_products(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
