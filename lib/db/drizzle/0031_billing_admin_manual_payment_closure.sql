-- Billing admin/manual payment closure.
-- This migration keeps the formal Drizzle chain aligned with the runtime schema
-- so a fresh PostgreSQL database does not depend on scripts/migrate-phase345.sql.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES plans(id);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_webhook_events_correlation
  ON webhook_events(correlation_id)
  WHERE correlation_id IS NOT NULL;

INSERT INTO plans (key, slug, name, name_ar, price_usd, price_usd_annual, price_sar, price_yer, billing_cycle, is_active, sort_order, limits, features)
VALUES
  (
    'free',
    'free',
    'Free',
    'مجاني',
    0,
    0,
    0,
    NULL,
    'monthly',
    true,
    10,
    '{"channels":1,"agents":1,"team_members":1,"contacts":100,"monthly_points":1000,"knowledge_documents":1,"products":20,"auto_reply":false}'::jsonb,
    ARRAY['inbox','ai_agent','catalog']
  ),
  (
    'starter',
    'starter',
    'Starter',
    'البداية',
    19,
    182,
    71.25,
    NULL,
    'monthly',
    true,
    20,
    '{"channels":1,"agents":1,"team_members":2,"contacts":1000,"monthly_points":10000,"knowledge_documents":1,"products":500,"auto_reply":true}'::jsonb,
    ARRAY['inbox','ai_agent','catalog','basic_automation']
  ),
  (
    'growth',
    'growth',
    'Growth',
    'النمو',
    49,
    470,
    183.75,
    NULL,
    'monthly',
    true,
    30,
    '{"channels":3,"agents":3,"team_members":5,"contacts":10000,"monthly_points":40000,"knowledge_documents":5,"products":5000,"auto_reply":true}'::jsonb,
    ARRAY['inbox','ai_agent','catalog','automation','campaigns','advanced_analytics','vision_voice']
  ),
  (
    'professional',
    'professional',
    'Professional',
    'احترافي',
    140,
    1344,
    525,
    NULL,
    'monthly',
    true,
    40,
    '{"channels":10,"agents":10,"team_members":15,"contacts":50000,"monthly_points":100000,"knowledge_documents":20,"products":25000,"auto_reply":true}'::jsonb,
    ARRAY['inbox','ai_agent','catalog','automation','campaigns','advanced_analytics','vision_voice','priority_support']
  ),
  (
    'business',
    'business',
    'Business',
    'الأعمال',
    NULL,
    NULL,
    NULL,
    NULL,
    'monthly',
    true,
    50,
    '{"channels":"custom","agents":"custom","team_members":"custom","contacts":"custom","monthly_points":"custom","knowledge_documents":"custom","products":"custom","auto_reply":true}'::jsonb,
    ARRAY['everything','priority_support']
  )
ON CONFLICT (slug) DO UPDATE SET
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  name_ar = EXCLUDED.name_ar,
  price_usd = EXCLUDED.price_usd,
  price_usd_annual = EXCLUDED.price_usd_annual,
  price_sar = EXCLUDED.price_sar,
  price_yer = EXCLUDED.price_yer,
  billing_cycle = EXCLUDED.billing_cycle,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  limits = EXCLUDED.limits,
  features = EXCLUDED.features;

CREATE TABLE IF NOT EXISTS point_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid UNIQUE NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS point_topup_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  description_ar text,
  description_en text,
  points integer NOT NULL,
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  allowed_plan_slugs text[] NOT NULL DEFAULT '{}',
  effective_from timestamptz,
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_topup_products_points'
  ) THEN
    ALTER TABLE point_topup_products
      ADD CONSTRAINT chk_point_topup_products_points CHECK (points > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_topup_products_price'
  ) THEN
    ALTER TABLE point_topup_products
      ADD CONSTRAINT chk_point_topup_products_price CHECK (price_cents > 0);
  END IF;
END $$;

INSERT INTO point_topup_products (slug, name_ar, name_en, points, price_cents, currency, sort_order)
VALUES
  ('topup_5k',  'شحنة صغيرة', 'Small Bundle', 5000,  700,  'USD', 10),
  ('topup_20k', 'شحنة مرنة',  'Flex Bundle',  20000, 2500, 'USD', 20),
  ('topup_50k', 'شحنة كبيرة', 'Large Bundle', 50000, 5900, 'USD', 30)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS point_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  topup_product_id uuid NOT NULL REFERENCES point_topup_products(id),
  product_slug_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  points_snapshot integer NOT NULL,
  price_cents_snapshot integer NOT NULL,
  currency_snapshot text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending_payment',
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  rejected_at timestamptz,
  rejected_by uuid REFERENCES users(id),
  rejection_reason text,
  credited_grant_id uuid,
  paid_amount_minor text,
  paid_currency text,
  refund_type text,
  refunded_at timestamptz,
  refunded_by uuid REFERENCES users(id),
  refunded_amount_minor text,
  refunded_currency text,
  refund_reason text,
  refund_idempotency_key text UNIQUE,
  idempotency_key text UNIQUE NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_purchase_orders_points'
  ) THEN
    ALTER TABLE point_purchase_orders
      ADD CONSTRAINT chk_point_purchase_orders_points CHECK (points_snapshot > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_purchase_orders_price'
  ) THEN
    ALTER TABLE point_purchase_orders
      ADD CONSTRAINT chk_point_purchase_orders_price CHECK (price_cents_snapshot > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_purchase_orders_status'
  ) THEN
    ALTER TABLE point_purchase_orders
      ADD CONSTRAINT chk_point_purchase_orders_status CHECK (status IN (
        'pending_payment',
        'under_review',
        'approved',
        'rejected',
        'expired',
        'cancelled',
        'refunded',
        'chargeback'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS point_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES point_wallets(id),
  grant_type text NOT NULL,
  original_micro_points bigint NOT NULL,
  remaining_micro_points bigint NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  source_type text,
  source_id text,
  idempotency_key text UNIQUE NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_grants_remaining'
  ) THEN
    ALTER TABLE point_grants
      ADD CONSTRAINT chk_point_grants_remaining CHECK (remaining_micro_points >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_grants_original'
  ) THEN
    ALTER TABLE point_grants
      ADD CONSTRAINT chk_point_grants_original CHECK (original_micro_points > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_grants_remaining_le_original'
  ) THEN
    ALTER TABLE point_grants
      ADD CONSTRAINT chk_point_grants_remaining_le_original
      CHECK (remaining_micro_points <= original_micro_points);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_grants_status'
  ) THEN
    ALTER TABLE point_grants
      ADD CONSTRAINT chk_point_grants_status CHECK (status IN (
        'active',
        'exhausted',
        'expired',
        'frozen',
        'reversed'
      ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES point_wallets(id),
  grant_id uuid REFERENCES point_grants(id),
  transaction_type text NOT NULL,
  micro_points bigint NOT NULL,
  source_type text,
  source_id text,
  idempotency_key text UNIQUE NOT NULL,
  reason text,
  actor_type text,
  actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_point_ledger_type'
  ) THEN
    ALTER TABLE point_ledger
      ADD CONSTRAINT chk_point_ledger_type CHECK (transaction_type IN (
        'credit',
        'debit',
        'expiration',
        'reversal',
        'refund',
        'admin_adjustment'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_ppo_credited_grant'
  ) THEN
    ALTER TABLE point_purchase_orders
      ADD CONSTRAINT fk_ppo_credited_grant
      FOREIGN KEY (credited_grant_id) REFERENCES point_grants(id);
  END IF;
END $$;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS submission_type text NOT NULL DEFAULT 'subscription';

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS point_purchase_order_id uuid REFERENCES point_purchase_orders(id) ON DELETE RESTRICT;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS receipt_file_url text;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS paid_amount_minor text;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS paid_currency text;

ALTER TABLE payment_submissions
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE payment_submissions
  ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE payment_submissions
  ALTER COLUMN amount_yer DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_submissions_type_refs'
  ) THEN
    ALTER TABLE payment_submissions
      ADD CONSTRAINT chk_payment_submissions_type_refs
      CHECK (
        (submission_type = 'subscription' AND plan_id IS NOT NULL AND point_purchase_order_id IS NULL)
        OR
        (submission_type = 'point_topup' AND plan_id IS NULL AND point_purchase_order_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_submissions_status_lifecycle'
  ) THEN
    ALTER TABLE payment_submissions
      ADD CONSTRAINT chk_payment_submissions_status_lifecycle
      CHECK (status IN (
        'pending',
        'payment_submitted',
        'pending_payment',
        'under_review',
        'confirmed',
        'approved',
        'rejected',
        'cancelled',
        'expired',
        'refunded',
        'chargeback'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_submissions_type_status_created
  ON payment_submissions(submission_type, status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_subscription_review_guard
  ON payment_submissions(workspace_id, plan_id, billing_cycle, status)
  WHERE submission_type = 'subscription' AND status = 'under_review';

CREATE INDEX IF NOT EXISTS idx_point_wallets_ws
  ON point_wallets(workspace_id);

CREATE INDEX IF NOT EXISTS idx_point_grants_ws_status
  ON point_grants(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_point_grants_ws_expires
  ON point_grants(workspace_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_point_grants_wallet
  ON point_grants(wallet_id);

CREATE INDEX IF NOT EXISTS idx_point_purchase_orders_ws_status
  ON point_purchase_orders(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_point_purchase_orders_status_created
  ON point_purchase_orders(status, created_at);

CREATE INDEX IF NOT EXISTS idx_point_ledger_ws_created
  ON point_ledger(workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_point_ledger_wallet
  ON point_ledger(wallet_id);

CREATE INDEX IF NOT EXISTS idx_point_ledger_grant
  ON point_ledger(grant_id);
