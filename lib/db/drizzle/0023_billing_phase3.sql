-- Closure Phase 3A: billing plans, subscriptions, usage, manual payments.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS name_ar text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_yer_annual numeric(10,2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;

UPDATE plans SET key = slug WHERE key IS NULL;
UPDATE plans SET name_ar = name WHERE name_ar IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_key ON plans(key);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_payment_ref text;

UPDATE subscriptions SET started_at = created_at WHERE started_at IS NULL;
UPDATE subscriptions SET status = 'trialing' WHERE status = 'trial';

CREATE TABLE IF NOT EXISTS usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  messages_sent integer NOT NULL DEFAULT 0,
  agents_count integer NOT NULL DEFAULT 0,
  contacts_count integer NOT NULL DEFAULT 0,
  team_members integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_counters_workspace_period_unique UNIQUE (workspace_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_ws_period ON usage_counters(workspace_id, period_month);

CREATE TABLE IF NOT EXISTS payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  amount_yer numeric(14,2) NOT NULL,
  payment_method text NOT NULL,
  reference text,
  receipt_note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_ws_status ON payment_submissions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_status_created ON payment_submissions(status, created_at);

INSERT INTO plans (key, slug, name, name_ar, price_yer, price_yer_annual, billing_cycle, is_active, sort_order, limits, features)
VALUES
  ('trial', 'trial', 'Trial', 'تجربة مجانية', 0, 0, 'monthly', true, 10, '{"channels":3,"agents":3,"monthly_messages":1000,"team_members":5,"contacts":500}'::jsonb, ARRAY['inbox','ai_agent','catalog','analytics','campaigns']),
  ('starter', 'starter', 'Starter', 'البداية', 15000, 144000, 'monthly', true, 20, '{"channels":2,"agents":1,"monthly_messages":2000,"team_members":3,"contacts":1000}'::jsonb, ARRAY['inbox','ai_agent','catalog']),
  ('growth', 'growth', 'Growth', 'النمو', 35000, 336000, 'monthly', true, 30, '{"channels":5,"agents":3,"monthly_messages":10000,"team_members":10,"contacts":10000}'::jsonb, ARRAY['inbox','ai_agent','catalog','analytics','campaigns']),
  ('business', 'business', 'Business', 'الأعمال', 75000, 720000, 'monthly', true, 40, '{"channels":10,"agents":10,"monthly_messages":50000,"team_members":30,"contacts":50000}'::jsonb, ARRAY['inbox','ai_agent','catalog','analytics','campaigns','priority_support'])
ON CONFLICT (slug) DO UPDATE SET
  key = EXCLUDED.key,
  name_ar = EXCLUDED.name_ar,
  price_yer = EXCLUDED.price_yer,
  price_yer_annual = EXCLUDED.price_yer_annual,
  billing_cycle = EXCLUDED.billing_cycle,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  limits = EXCLUDED.limits,
  features = EXCLUDED.features;
