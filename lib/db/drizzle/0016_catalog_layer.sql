CREATE TABLE IF NOT EXISTS catalog_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_account_id uuid REFERENCES channel_accounts(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  external_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  sync_status text NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  last_sync_error text,
  sync_cursor text,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_catalog_sources_ws_type_external UNIQUE (workspace_id, source_type, external_id)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  catalog_source_id uuid NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  external_product_id text NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  price numeric(14,2),
  currency text DEFAULT 'YER',
  availability text,
  inventory_count integer,
  image_url text,
  product_url text,
  brand text,
  raw jsonb NOT NULL DEFAULT '{}',
  is_visible boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_products_ws_source_external UNIQUE (workspace_id, catalog_source_id, external_product_id)
);

CREATE TABLE IF NOT EXISTS social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  catalog_source_id uuid NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  external_post_id text NOT NULL,
  message text,
  post_type text,
  permalink_url text,
  media_url text,
  published_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}',
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_social_posts_ws_source_external UNIQUE (workspace_id, catalog_source_id, external_post_id)
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  catalog_source_id uuid NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  external_ad_id text NOT NULL,
  name text NOT NULL,
  status text,
  objective text,
  promoted_product_ids jsonb DEFAULT '[]',
  ad_creative_text text,
  ad_creative_image_url text,
  start_time timestamptz,
  end_time timestamptz,
  raw jsonb NOT NULL DEFAULT '{}',
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ad_campaigns_ws_source_external UNIQUE (workspace_id, catalog_source_id, external_ad_id)
);

CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  catalog_source_id uuid NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  status text NOT NULL,
  items_synced integer NOT NULL DEFAULT 0,
  items_failed integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_products_ws ON products(workspace_id, is_visible);
CREATE INDEX IF NOT EXISTS idx_products_source ON products(catalog_source_id);
CREATE INDEX IF NOT EXISTS idx_products_availability ON products(workspace_id, availability);
CREATE INDEX IF NOT EXISTS idx_social_posts_ws ON social_posts(workspace_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_ws_status ON ad_campaigns(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_sources_ws ON catalog_sources(workspace_id, source_type);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON catalog_sync_runs(catalog_source_id, started_at DESC);
