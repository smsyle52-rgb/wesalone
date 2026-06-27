-- =============================================================
-- Khadamatak Phase 3/4/5 Migration Bundle
-- Generated: 2026-05-18T15:37:47Z
-- Safe to run on existing databases: uses IF NOT EXISTS everywhere
-- Safe to run multiple times: idempotent
-- =============================================================
--
-- Source migrations read in intended execution order:
--   0000_faithful_vance_astro.sql
--   0001_common_serpent_society.sql
--   0002_wandering_microchip.sql
--   0003_critical_indexes.sql
--   0004_phase2_modules.sql
--   0005_broadcast_outbox_idempotency.sql
--   0006_agent_settings.sql
--   0007_domain_events.sql
--   0008_inbox_depth.sql
--   0009_settings_depth.sql
--   0010_agent_memory.sql
--   0011_phase4_vectors.sql
--   0012_phase4_trust_mode.sql
--   0013_phase4_realtime_health.sql
--   0014_embedding_dim_fix.sql
--
-- Drizzle migration journal detected from lib/db/drizzle.config.ts:
--   table: public.__drizzle_migrations
--
-- Active journal writes are intentionally omitted because this bundle is
-- DDL-only by instruction: no INSERT, UPDATE, DELETE, TRUNCATE, or seed data.
-- If an operator needs to mark migrations as applied for drizzle-kit, do that
-- separately after validating this bundle.
--
-- This bundle deliberately omits destructive DROP statements from source
-- migrations. The embedding dimension path is handled safely: new databases
-- get vector(768); databases that already have a different vector dimension
-- receive a NOTICE and require a separate reviewed fix.

BEGIN;

-- =============================================================
-- Phase 1C: Critical indexes + idempotency_keys
-- Adds tenant/query indexes and the idempotency table if absent.
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_contacts_ws ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contacts_ws_created ON contacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_ws_status ON conversations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_conv_ws_assigned ON conversations(workspace_id, assigned_membership_id);
CREATE INDEX IF NOT EXISTS idx_conv_ws_lastmsg ON conversations(workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_ws_provider ON messages(workspace_id, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_tickets_ws_status ON tickets(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_ws_status_due ON tasks(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_ws_sched ON followups(workspace_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_orders_ws_status ON orders(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_ws_status ON payments(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_audit_ws_created ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_channels_normalized ON contact_channels(workspace_id, channel_type, normalized_identifier);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text NOT NULL,
  workspace_id uuid NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  response_status int,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_workspace_key ON idempotency_keys(workspace_id, key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- =============================================================
-- Phase 2A: Templates, broadcasts, automations
-- Adds campaign/template/automation data model tables.
-- =============================================================

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'ar',
  category text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  meta_template_id text,
  rejection_reason text,
  channel_account_id uuid REFERENCES channel_accounts(id),
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_templates_ws_name_language ON whatsapp_templates(workspace_id, name, language);
CREATE INDEX IF NOT EXISTS idx_templates_ws_status ON whatsapp_templates(workspace_id, status);

CREATE TABLE IF NOT EXISTS template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES whatsapp_templates(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  status text NOT NULL,
  components jsonb NOT NULL,
  response_json jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_versions_template_version ON template_versions(template_id, version_number);
CREATE INDEX IF NOT EXISTS idx_template_versions_tpl ON template_versions(template_id, version_number DESC);

CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_id uuid NOT NULL REFERENCES whatsapp_templates(id),
  channel_account_id uuid NOT NULL REFERENCES channel_accounts(id),
  audience_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  variable_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{"total":0,"sent":0,"delivered":0,"read":0,"replied":0,"failed":0}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_ws_status ON broadcasts(workspace_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  contact_channel_id uuid REFERENCES contact_channels(id),
  status text NOT NULL DEFAULT 'queued',
  message_id uuid REFERENCES messages(id),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  error_code text,
  error_message text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_recipients_broadcast_contact ON broadcast_recipients(broadcast_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_bc ON broadcast_recipients(broadcast_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact ON broadcast_recipients(workspace_id, contact_id);

CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger jsonb NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  last_run_at timestamptz,
  run_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_ws_status ON automations(workspace_id, status);

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL,
  trigger_payload jsonb NOT NULL,
  conditions_evaluated jsonb,
  actions_executed jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_auto ON automation_runs(automation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_events_entity ON outbox_events(entity_type, entity_id);

-- =============================================================
-- Phase 3: Domain events, quick replies, saved views, SLA, business hours
-- Adds event-driven automation foundation and inbox/settings depth tables.
-- =============================================================

CREATE TABLE IF NOT EXISTS domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  processed_at timestamptz,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  ALTER TABLE domain_events
    ADD CONSTRAINT domain_events_workspace_id_workspaces_id_fk
    FOREIGN KEY (workspace_id)
    REFERENCES public.workspaces(id)
    ON DELETE cascade
    ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_domain_events_pending ON domain_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_ws_type ON domain_events(workspace_id, event_type, created_at);

CREATE TABLE IF NOT EXISTS quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_replies_ws_shortcut ON quick_replies(workspace_id, shortcut);
CREATE INDEX IF NOT EXISTS idx_quick_replies_ws ON quick_replies(workspace_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  resource text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  is_pinned boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_views_ws_user ON saved_views(workspace_id, user_id, sort_order);

CREATE TABLE IF NOT EXISTS sla_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel_type text NULL,
  priority text NULL,
  first_response_minutes int NOT NULL,
  resolution_minutes int NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_sla_rules_ws_active ON sla_rules(workspace_id, active);

CREATE TABLE IF NOT EXISTS business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day_of_week int NOT NULL,
  open_time time NULL,
  close_time time NULL,
  is_closed boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'Asia/Aden'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_hours_ws_day ON business_hours(workspace_id, day_of_week);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel text NOT NULL,
  events jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(workspace_id, user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label text NOT NULL,
  hashed_key text NOT NULL,
  last4 text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]',
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_ws ON api_keys(workspace_id);

-- =============================================================
-- Phase 4: Agent memory, auto reply decisions, service heartbeats
-- Adds operational AI memory, trust audit, and readiness heartbeat tables.
-- =============================================================

CREATE TABLE IF NOT EXISTS agent_memory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE cascade,
  agent_id uuid REFERENCES ai_agents(id) ON DELETE set null,
  summary text,
  recent_turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_message_id uuid,
  token_estimate integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_conv_agent ON agent_memory_snapshots(conversation_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_ws_conv ON agent_memory_snapshots(workspace_id, conversation_id);

CREATE TABLE IF NOT EXISTS auto_reply_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE cascade,
  agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE cascade,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE cascade,
  decision text NOT NULL,
  reason text NOT NULL,
  confidence numeric(3,2),
  topic_detected text,
  sent_message_id uuid REFERENCES messages(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_decisions_conv ON auto_reply_decisions(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_decisions_ws_day ON auto_reply_decisions(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  version text,
  metadata jsonb
);

-- =============================================================
-- ADD COLUMNS to existing tables
-- Every ALTER TABLE ADD COLUMN is wrapped in DO/EXCEPTION for idempotency.
-- =============================================================

DO $$
BEGIN
  ALTER TABLE outbox_messages ADD COLUMN next_attempt_at timestamptz;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_outbox_msgs_status ON outbox_messages(status, next_attempt_at);

DO $$
BEGIN
  ALTER TABLE idempotency_keys ADD COLUMN method text;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE idempotency_keys ADD COLUMN path text;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE idempotency_keys ADD COLUMN response_status int;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE idempotency_keys ADD COLUMN response_body jsonb;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE outbox_events ADD COLUMN idempotency_key text;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_events_workspace_idempotency ON outbox_events(workspace_id, idempotency_key);

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN temperature numeric(4, 2) NOT NULL DEFAULT 0.30;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN max_output_tokens integer NOT NULL DEFAULT 1024;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN knowledge_base_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN trust_mode text NOT NULL DEFAULT 'suggest';
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN trust_confidence_threshold numeric(3,2) NOT NULL DEFAULT '0.80';
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN trust_topics jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN trust_blocklist jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN max_auto_replies_per_conversation integer NOT NULL DEFAULT 3;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN escalate_after_failed_auto integer NOT NULL DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ai_agents ADD COLUMN daily_auto_send_quota integer NOT NULL DEFAULT 200;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

-- =============================================================
-- Phase 4/5: Knowledge retrieval vector/lexical support
-- Adds lexical tsv support and vector(768) for text-embedding-005 when pgvector exists.
-- Existing non-768 embedding columns are left unchanged for safety.
-- =============================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension is unavailable; lexical fallback will be used';
END $$;

DO $$
BEGIN
  IF to_regclass('public.knowledge_chunks') IS NOT NULL THEN
    ALTER TABLE knowledge_chunks ADD COLUMN tsv tsvector;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  IF to_regclass('public.knowledge_chunks') IS NOT NULL THEN
    ALTER TABLE knowledge_chunks ADD COLUMN embedding_model text;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
BEGIN
  IF to_regclass('public.knowledge_chunks') IS NOT NULL THEN
    ALTER TABLE knowledge_chunks ADD COLUMN embedded_at timestamptz;
  END IF;
EXCEPTION WHEN duplicate_column THEN
  NULL;
END $$;

DO $$
DECLARE
  existing_embedding_type text;
BEGIN
  IF to_regclass('public.knowledge_chunks') IS NULL THEN
    RAISE NOTICE 'knowledge_chunks table is missing; skipping embedding column setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE NOTICE 'pgvector extension is unavailable; skipping embedding column setup';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_chunks'
      AND column_name = 'embedding'
  ) THEN
    EXECUTE 'ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(768)';
  ELSE
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO existing_embedding_type
    FROM pg_attribute a
    WHERE a.attrelid = 'public.knowledge_chunks'::regclass
      AND a.attname = 'embedding'
      AND NOT a.attisdropped;

    IF existing_embedding_type IS DISTINCT FROM 'vector(768)' THEN
      RAISE NOTICE 'knowledge_chunks.embedding exists as %, not changed by DDL-only bundle', existing_embedding_type;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.knowledge_chunks') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON knowledge_chunks USING gin (tsv)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
     AND to_regclass('public.knowledge_chunks') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'knowledge_chunks'
         AND column_name = 'embedding'
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION knowledge_chunks_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('simple', coalesce(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.knowledge_chunks') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'trg_knowledge_chunks_tsv_update'
         AND tgrelid = 'public.knowledge_chunks'::regclass
     ) THEN
    EXECUTE 'CREATE TRIGGER trg_knowledge_chunks_tsv_update
      BEFORE INSERT OR UPDATE OF chunk_text ON knowledge_chunks
      FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_tsv_update()';
  END IF;
END $$;

-- =============================================================
-- Phase Catalog: Meta catalog/posts/ads mirror layer
-- =============================================================

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

-- =============================================================
-- Closure Phase 2A: channel-aware agent behavior
-- =============================================================

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS channel_tone jsonb NOT NULL DEFAULT '{}'::jsonb;

-- =============================================================
-- Closure Phase 2B: sector profiles and behavior
-- =============================================================

CREATE TABLE IF NOT EXISTS sector_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_key text NOT NULL,
  name_ar text NOT NULL,
  description_ar text NOT NULL,
  base_knowledge jsonb NOT NULL DEFAULT '{}'::jsonb,
  behavior_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_goals jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_tone text NOT NULL DEFAULT 'مهني وودود',
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sector_profiles_key UNIQUE (sector_key)
);

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS sector_key text NOT NULL DEFAULT 'services_general';
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS sector_behavior_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO sector_profiles (sector_key, name_ar, description_ar, base_knowledge, behavior_profile, service_goals, default_tone, guardrails)
VALUES
('retail_sales','متجر بيع','متاجر تبيع منتجات مباشرة للعملاء.','{"common_questions":["السعر","التوفر","طريقة الطلب","سياسة الاستبدال"]}','{"serve":"اعرض المنتجات بوضوح، اقنع بلطف وصدق، اذكر الضمان أو سياسة الاسترجاع فقط إذا كانت موجودة في معرفة التاجر، ووجّه العميل لإكمال الطلب دون ضغط."}','{"success":"يفهم العميل المنتج وطريقة الطلب والخطوة التالية."}','ودود ومقنع باعتدال','{"never":["لا تخترع خصومات","لا تؤكد الدفع","لا تعد بسياسة غير موجودة"]}'),
('appointments_clinic','عيادات ومواعيد','خدمات طبية أو تجميلية تعتمد على الحجز.','{"common_questions":["الخدمة","الموعد","الطبيب","التحضير للزيارة"]}','{"serve":"ابدأ بالطمأنة، اجمع الخدمة والوقت المناسب، اقترح موعدًا واضحًا، وأكد التفاصيل بلغة هادئة."}','{"success":"موعد واضح التفاصيل أو تحويل منظم للموظف."}','هادئ ومطمئن','{"never":["لا تقدم تشخيصًا طبيًا","لا تؤكد دفعًا","لا تعد بنتيجة علاجية"]}'),
('restaurant_food','مطاعم وأغذية','مطاعم ومطابخ وخدمات توصيل الطعام.','{"common_questions":["القائمة","الأسعار","التوصيل","الكمية"]}','{"serve":"اعرض القائمة، خذ الطلب بدقة، أكد الأصناف والكميات، ثم اسأل عن منطقة التوصيل قبل الإجمالي عند الحاجة."}','{"success":"طلب دقيق ومؤكد مع منطقة التوصيل والخطوة التالية."}','سريع وواضح','{"never":["لا تخترع أسعارًا","لا تؤكد دفعًا","لا تعد بتوصيل خارج المعرفة"]}'),
('perfumes_gifts','عطور وهدايا','متاجر عطور وهدايا ومناسبات.','{"common_questions":["المناسبة","الرائحة","التغليف","السعر"]}','{"serve":"ساعد العميل على الاختيار حسب المناسبة والتفضيل، اقترح خيارات مناسبة، وتعامل مع طلبات التغليف بوضوح."}','{"success":"يجد العميل خيارًا مناسبًا ويعرف طريقة الطلب."}','راقي ولطيف','{"never":["لا تخترع توفرًا أو خصمًا","لا تعد بتغليف غير مؤكد"]}'),
('clothing','ملابس وأقمشة','متاجر ملابس وأقمشة ومقاسات.','{"common_questions":["المقاس","الخامة","الألوان","التوفر"]}','{"serve":"ساعد في المقاسات والخامات، اقترح بناءً على الحاجة، واسأل عن المقاس أو اللون عند نقص التفاصيل."}','{"success":"يجد العميل القطعة المناسبة ويعرف طريقة الطلب."}','عملي وودود','{"never":["لا تخترع مقاسات أو توفرًا","لا تؤكد سياسة استبدال غير موجودة"]}'),
('services_general','خدمات عامة','أنشطة خدمية متنوعة.','{"common_questions":["نوع الخدمة","السعر التقريبي","المدة","طريقة البدء"]}','{"serve":"افهم احتياج العميل، اشرح الخدمة بوضوح، اجمع بيانات التواصل، وضع توقعات صادقة للخطوة التالية."}','{"success":"يفهم العميل الخدمة والخطوة التالية بوضوح."}','مهني ومباشر','{"never":["لا تعد بنتيجة غير مضمونة","لا تؤكد دفعًا","لا تنفذ إجراءً بدل الموظف"]}')
ON CONFLICT (sector_key) DO NOTHING;

-- =============================================================
-- Closure Phase 2C: safe escalation flags
-- =============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS needs_human boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalation_reason text;
CREATE INDEX IF NOT EXISTS idx_conv_ws_needs_human ON conversations(workspace_id, needs_human);

-- =============================================================
-- Closure Phase 2D: learned answers for safe context injection
-- =============================================================

CREATE TABLE IF NOT EXISTS learned_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question_pattern text NOT NULL,
  best_answer text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  topic_sensitivity text NOT NULL DEFAULT 'simple',
  status text NOT NULL DEFAULT 'pending_review',
  confidence numeric(3,2) NOT NULL DEFAULT 0.70,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learned_answers_ws_status ON learned_answers(workspace_id, status);

-- =============================================================
-- Closure Phase 2E: lightweight Yemeni location context
-- =============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS location_note text;

-- =============================================================
-- Closure Phase 2F: media attachments for image and voice context
-- =============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =============================================================
-- Closure Phase 3A: billing plans, subscriptions, usage, manual payments
-- =============================================================

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

-- =============================================================
-- Billing schema columns (USD-canonical pricing + points metering)
-- =============================================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_usd numeric(10,2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_usd_annual numeric(10,2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_sar numeric(10,2);
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS amount_currency text NOT NULL DEFAULT 'YER';
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS exchange_rate_snapshot jsonb;
-- اسم الخطة التاريخي يُحفظ كنص قبل حذف مرجع الخطة (حماية المدفوعات التاريخية).
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS plan_name_snapshot text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS points_balance integer NOT NULL DEFAULT 0;
ALTER TABLE usage_counters ADD COLUMN IF NOT EXISTS points_used integer NOT NULL DEFAULT 0;

-- =============================================================
-- Billing patch C — Phase 1: حصر الكتالوج في 5 باقات (حذف فعلي + ترحيل آمن)
-- يحذف كل خطة تاريخية (trial/المحترف/الفريق/أي قديمة) فعلياً بعد ترحيل اشتراكاتها.
-- transactional + idempotent. المصدر التشغيلي المطابق: artifacts/api-server/src/lib/seed.ts
-- mapping: trial→free · starter/growth/business تُعاد تعريفها بنفس الـslug · أي خطة أخرى→free.
-- =============================================================
BEGIN;

-- (1) snapshot للرجوع عند فشل الترحيل فقط (مرة واحدة؛ لا يُستخدم تشغيلياً ولا يُعاد توليده).
CREATE TABLE IF NOT EXISTS billing_legacy_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  ref_id uuid,
  workspace_id uuid,
  plan_slug text,
  plan_name text,
  status text,
  raw jsonb NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO billing_legacy_snapshot (kind, ref_id, plan_slug, plan_name, raw)
SELECT 'plan', p.id, p.slug, p.name, to_jsonb(p) FROM plans p
WHERE NOT EXISTS (SELECT 1 FROM billing_legacy_snapshot WHERE kind = 'plan');

INSERT INTO billing_legacy_snapshot (kind, ref_id, workspace_id, plan_slug, status, raw)
SELECT 'subscription', s.id, s.workspace_id, p.slug, s.status, to_jsonb(s)
FROM subscriptions s JOIN plans p ON p.id = s.plan_id
WHERE NOT EXISTS (SELECT 1 FROM billing_legacy_snapshot WHERE kind = 'subscription');

-- (2) احفظ اسم الخطة التاريخي في المدفوعات قبل أي تغيير مرجع.
UPDATE payment_submissions ps SET plan_name_snapshot = p.name
FROM plans p WHERE p.id = ps.plan_id AND ps.plan_name_snapshot IS NULL;

-- (3) أنشئ/حدّث الخطط الخمس المعتمدة (نفس تعريف seed.ts — مصدر واحد).
INSERT INTO plans (key, slug, name, name_ar, price_usd, price_usd_annual, price_sar, price_yer, billing_cycle, is_active, sort_order, limits, features)
VALUES
  ('free','free','Free','مجاني', 0, 0, 0, NULL, 'monthly', true, 10,
    '{"channels":1,"agents":1,"team_members":1,"contacts":100,"monthly_points":1000,"knowledge_bases":1,"products":20,"auto_reply":false}'::jsonb,
    ARRAY['inbox','ai_agent','catalog']),
  ('starter','starter','Starter','البداية', 19, 182, 71.25, NULL, 'monthly', true, 20,
    '{"channels":1,"agents":1,"team_members":2,"contacts":1000,"monthly_points":10000,"knowledge_bases":1,"products":500,"auto_reply":true}'::jsonb,
    ARRAY['inbox','ai_agent','catalog','basic_automation']),
  ('growth','growth','Growth','النمو', 59, 566, 221.25, NULL, 'monthly', true, 30,
    '{"channels":3,"agents":3,"team_members":5,"contacts":10000,"monthly_points":40000,"knowledge_bases":5,"products":5000,"auto_reply":true}'::jsonb,
    ARRAY['inbox','ai_agent','catalog','automation','campaigns','advanced_analytics','vision_voice']),
  ('professional','professional','Professional','احترافي', 149, 1430, 558.75, NULL, 'monthly', true, 40,
    '{"channels":10,"agents":10,"team_members":15,"contacts":50000,"monthly_points":100000,"knowledge_bases":20,"products":25000,"auto_reply":true}'::jsonb,
    ARRAY['inbox','ai_agent','catalog','automation','campaigns','advanced_analytics','vision_voice','priority_support']),
  ('business','business','Business','الأعمال', NULL, NULL, NULL, NULL, 'monthly', true, 50,
    '{"channels":"custom","agents":"custom","team_members":"custom","contacts":"custom","monthly_points":"custom","knowledge_bases":"custom","products":"custom","auto_reply":true}'::jsonb,
    ARRAY['everything','priority_support'])
ON CONFLICT (slug) DO UPDATE SET
  key = EXCLUDED.key, name = EXCLUDED.name, name_ar = EXCLUDED.name_ar,
  price_usd = EXCLUDED.price_usd, price_usd_annual = EXCLUDED.price_usd_annual,
  price_sar = EXCLUDED.price_sar, price_yer = EXCLUDED.price_yer,
  billing_cycle = EXCLUDED.billing_cycle, is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order, limits = EXCLUDED.limits, features = EXCLUDED.features;

-- (4) رحّل اشتراكات ومدفوعات أي خطة خارج الخمس → free (trial والتاريخية)، مع الحفاظ على الدورة والحالة.
UPDATE subscriptions s
SET plan_id = (SELECT id FROM plans WHERE slug = 'free'), updated_at = now()
FROM plans old
WHERE old.id = s.plan_id AND old.slug NOT IN ('free','starter','growth','professional','business');

UPDATE payment_submissions ps
SET plan_id = (SELECT id FROM plans WHERE slug = 'free')
FROM plans old
WHERE old.id = ps.plan_id AND old.slug NOT IN ('free','starter','growth','professional','business');

-- (4b) حماية دفاعية: أي اشتراك بمرجع خطة معلّق (لا وجود لها) → free.
UPDATE subscriptions s
SET plan_id = (SELECT id FROM plans WHERE slug = 'free'), updated_at = now()
WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = s.plan_id);

-- (5) تقرير الترحيل (الأرقام تظهر في سجل خطوة migrate-database عند التطبيق).
DO $$
DECLARE v_old int; v_repointed int; r record;
BEGIN
  SELECT count(*) INTO v_old FROM plans WHERE slug NOT IN ('free','starter','growth','professional','business');
  SELECT count(*) INTO v_repointed FROM billing_legacy_snapshot
    WHERE kind = 'subscription' AND plan_slug NOT IN ('free','starter','growth','professional','business');
  RAISE NOTICE '[catalog-migration] خطط قديمة ستُحذف: %', v_old;
  RAISE NOTICE '[catalog-migration] اشتراكات رُحّلت من خطط قديمة إلى free: %', v_repointed;
  FOR r IN SELECT p.slug, count(*) AS n FROM subscriptions s JOIN plans p ON p.id = s.plan_id GROUP BY p.slug ORDER BY p.slug LOOP
    RAISE NOTICE '[catalog-migration] اشتراكات على الباقة %: %', r.slug, r.n;
  END LOOP;
END $$;

-- (6) احذف الخطط القديمة/التاريخية فعلياً (آمن: لا مراجع بعد الترحيل).
DELETE FROM plans WHERE slug NOT IN ('free','starter','growth','professional','business');

-- (7) تحقق صارم — أي إخفاق يُفشل الترحيل ويُرجِعه بالكامل.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM plans;
  IF v_count <> 5 THEN RAISE EXCEPTION 'catalog-migration: المتوقع 5 باقات، الموجود %', v_count; END IF;
  IF EXISTS (SELECT 1 FROM plans WHERE slug NOT IN ('free','starter','growth','professional','business')) THEN
    RAISE EXCEPTION 'catalog-migration: ما زالت توجد خطة تاريخية في الكتالوج'; END IF;
  IF EXISTS (SELECT 1 FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE p.slug NOT IN ('free','starter','growth','professional','business')) THEN
    RAISE EXCEPTION 'catalog-migration: ما زال اشتراك مرتبطاً بخطة تاريخية'; END IF;
  IF EXISTS (SELECT 1 FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'catalog-migration: اشتراك بمرجع خطة معلّق'; END IF;
END $$;

COMMIT;

-- =============================================================
-- Closure Phase 4A: in-app notifications
-- =============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title_ar text NOT NULL,
  body_ar text NOT NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(workspace_id, user_id, is_read, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_ws_created
  ON notifications(workspace_id, created_at);

-- =============================================================
-- Closure Phase 4B: account lifecycle
-- =============================================================

CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type
  ON auth_tokens(user_id, type, expires_at);

DO $$ BEGIN
  ALTER TABLE workspaces ADD COLUMN deactivated_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE workspaces ADD COLUMN deactivated_by uuid REFERENCES users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE workspaces ADD COLUMN deactivation_reason text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- =============================================================
-- 0027_contacts_scope10 — أعمدة وفهارس جهات الاتصال (النطاق 10)
-- أُضيف يدوياً 19 يونيو 2026: غيابه من هذه الحزمة سبّب توقّف استقبال
-- واتساب ~5 ساعات (contacts.custom_fields مفقود → upsertContact يرمي).
-- idempotent، آمن للتكرار. قاعدة حاكمة: أي migration جديد يُدمج هنا.
-- =============================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_contacts_ws_archived_created ON contacts(workspace_id, archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_ws_phone ON contacts(workspace_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_ws_email ON contacts(workspace_id, lower(email));
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_contacts_ws_name_trgm ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_ws_company_trgm ON contacts USING gin (company gin_trgm_ops);

-- =============================================================
-- 0028_orders_delivery — حقول التوصيل والشحن والدفع عند الاستلام (النطاق 11)
-- idempotent، آمن للتكرار. قاعدة حاكمة: أي migration جديد يُدمج هنا.
-- =============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'pickup';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_agent_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_receipt_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_enabled boolean NOT NULL DEFAULT false;

-- =============================================================
-- 0029_products_inventory — كتالوج المخزون الداخلي وربطه ببنود الطلبات (نطاق المخزون)
-- جدول inventory_products منفصل عن products (الأخير يخص كتالوج ميتا المتزامن).
-- idempotent، آمن للتكرار. قاعدة حاكمة: أي migration جديد يُدمج هنا.
-- =============================================================
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
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inventory_product_id uuid REFERENCES inventory_products(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;

-- =============================================================
-- Verification queries (SELECT only, no mutations)
-- These print confirmation that expected tables exist.
-- =============================================================

SELECT 'VERIFY: ' || tablename AS check
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'domain_events','quick_replies','saved_views','sla_rules',
  'business_hours','agent_memory_snapshots','auto_reply_decisions',
  'service_heartbeats','whatsapp_templates','template_versions',
  'broadcasts','broadcast_recipients','automations','automation_runs',
  'api_keys','notification_preferences','idempotency_keys',
  'catalog_sources','products','social_posts','ad_campaigns','catalog_sync_runs',
  'sector_profiles','learned_answers','usage_counters','payment_submissions',
  'notifications','auth_tokens','inventory_products'
)
ORDER BY tablename;

COMMIT;

-- =============================================================
-- Phase 2: نظام محفظة النقاط وشحن الرصيد
-- تعديل payment_submissions + 5 جداول جديدة
-- idempotent — آمن للتكرار (IF NOT EXISTS + ON CONFLICT DO NOTHING)
--
-- ترتيب إنشاء الجداول (مهم — FK dependencies):
--   1. point_wallets           (refs: workspaces)
--   2. point_topup_products    (refs: none)
--   3. point_purchase_orders   (refs: workspaces, point_topup_products)
--      credited_grant_id بلا FK حتى يُنشأ point_grants أولاً
--   4. point_grants            (refs: workspaces, point_wallets)
--   5. point_ledger            (refs: workspaces, point_wallets, point_grants)
--   6. ALTER payment_submissions  — يضيف FK إلى point_purchase_orders (الآن موجود)
--   7. ALTER point_purchase_orders — يضيف FK إلى point_grants (الآن موجود)
-- =============================================================

-- ── 1. point_wallets ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS point_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid UNIQUE NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. point_topup_products ──────────────────────────────────

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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ptp_points     CHECK (points      > 0),
  CONSTRAINT chk_ptp_price      CHECK (price_cents > 0),
  CONSTRAINT chk_ptp_currency   CHECK (currency IN ('USD'))
);

-- حزم افتراضية — idempotent
INSERT INTO point_topup_products (slug, name_ar, name_en, points, price_cents, currency, sort_order)
VALUES
  ('topup_5k',  'شحنة صغيرة', 'Small Bundle', 5000,  700,  'USD', 10),
  ('topup_20k', 'شحنة مرنة',  'Flex Bundle',  20000, 2500, 'USD', 20),
  ('topup_50k', 'شحنة كبيرة', 'Large Bundle', 50000, 5900, 'USD', 30)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. point_purchase_orders (بدون FK إلى point_grants حتى الآن) ──

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
  -- credited_grant_id بلا FK هنا — يُضاف بعد إنشاء point_grants (بند 7 أدناه)
  credited_grant_id uuid,
  idempotency_key text UNIQUE NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ppo_points    CHECK (points_snapshot > 0),
  CONSTRAINT chk_ppo_price     CHECK (price_cents_snapshot > 0),
  CONSTRAINT chk_ppo_status    CHECK (status IN (
    'pending_payment','under_review','approved','rejected',
    'expired','cancelled','refunded','chargeback'
  )),
  CONSTRAINT chk_ppo_approved_has_grant CHECK (
    status <> 'approved' OR credited_grant_id IS NOT NULL
  ),
  CONSTRAINT chk_ppo_rejected_no_grant CHECK (
    status <> 'rejected' OR credited_grant_id IS NULL
  )
);

-- ── 4. point_grants ──────────────────────────────────────────

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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_point_grants_remaining  CHECK (remaining_micro_points >= 0),
  CONSTRAINT chk_point_grants_original   CHECK (original_micro_points > 0),
  CONSTRAINT chk_point_grants_remaining_le_original CHECK (remaining_micro_points <= original_micro_points),
  CONSTRAINT chk_point_grants_status     CHECK (status IN ('active','exhausted','expired','frozen','reversed')),
  CONSTRAINT chk_purchased_has_expiry    CHECK (grant_type <> 'purchased' OR expires_at IS NOT NULL)
);

-- ── 5. point_ledger ──────────────────────────────────────────

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
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pl_type CHECK (transaction_type IN (
    'credit','debit','expiration','reversal','refund','admin_adjustment'
  ))
);

-- ── 6. تعديل payment_submissions (بعد إنشاء point_purchase_orders) ──────────
-- submission_type + plan_id nullable + point_purchase_order_id FK + receipt_file_url

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_submissions' AND column_name='submission_type') THEN
    ALTER TABLE payment_submissions
      ADD COLUMN submission_type text NOT NULL DEFAULT 'subscription';
  END IF;
  -- رفع NOT NULL من plan_id (مطلوب فقط لـsubscription، اختياري لـpoint_topup)
  BEGIN
    ALTER TABLE payment_submissions ALTER COLUMN plan_id DROP NOT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_submissions' AND column_name='point_purchase_order_id') THEN
    -- point_purchase_orders موجود الآن — FK آمن
    ALTER TABLE payment_submissions
      ADD COLUMN point_purchase_order_id uuid REFERENCES point_purchase_orders(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_submissions' AND column_name='receipt_file_url') THEN
    ALTER TABLE payment_submissions ADD COLUMN receipt_file_url text;
  END IF;
END $$;

-- CHECK: subscription ⇒ plan_id وجوباً؛ point_topup ⇒ point_purchase_order_id وجوباً
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ps_type_refs') THEN
    ALTER TABLE payment_submissions ADD CONSTRAINT chk_ps_type_refs CHECK (
      (submission_type = 'subscription'  AND plan_id IS NOT NULL AND point_purchase_order_id IS NULL) OR
      (submission_type = 'point_topup'   AND plan_id IS NULL     AND point_purchase_order_id IS NOT NULL)
    );
  END IF;
END $$;

-- ── 6b. payment_submissions: paid_amount_minor + paid_currency + nullable amount_yer ──
-- Phase-1 subscriptions used amount_yer; Phase-2 point_topup rows use paid_amount_minor.

DO $$
BEGIN
  -- جعل amount_yer nullable (الصفوف القديمة تحتفظ بقيمتها، الجديدة لا تحتاجه)
  BEGIN
    ALTER TABLE payment_submissions ALTER COLUMN amount_yer DROP NOT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_submissions' AND column_name='paid_amount_minor') THEN
    ALTER TABLE payment_submissions ADD COLUMN paid_amount_minor text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_submissions' AND column_name='paid_currency') THEN
    ALTER TABLE payment_submissions ADD COLUMN paid_currency text;
  END IF;
END $$;

-- ── 6c. point_purchase_orders: paid_amount_minor + paid_currency + refund columns ──

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='paid_amount_minor') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN paid_amount_minor text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='paid_currency') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN paid_currency text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refund_type') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refund_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refunded_at') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refunded_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refunded_by') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refunded_by uuid REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refunded_amount_minor') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refunded_amount_minor text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refunded_currency') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refunded_currency text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refund_reason') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refund_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='point_purchase_orders' AND column_name='refund_idempotency_key') THEN
    ALTER TABLE point_purchase_orders ADD COLUMN refund_idempotency_key text UNIQUE;
  END IF;
END $$;

-- ── 7. FK مؤجل: point_purchase_orders.credited_grant_id → point_grants ───────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ppo_credited_grant') THEN
    ALTER TABLE point_purchase_orders
      ADD CONSTRAINT fk_ppo_credited_grant
      FOREIGN KEY (credited_grant_id) REFERENCES point_grants(id);
  END IF;
END $$;

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_point_wallets_ws          ON point_wallets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_point_grants_ws_status    ON point_grants(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_point_grants_ws_expires   ON point_grants(workspace_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_point_grants_wallet       ON point_grants(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ppo_ws_status             ON point_purchase_orders(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ppo_status_created        ON point_purchase_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_point_ledger_ws_created   ON point_ledger(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_ledger_wallet       ON point_ledger(wallet_id);
CREATE INDEX IF NOT EXISTS idx_point_ledger_grant        ON point_ledger(grant_id);

-- =============================================================
-- 0030_parity_columns — Wave 1: Additive Chatwoot-parity columns
-- Columns written but not yet read; no behavior change.
-- New rows get display_id via trigger; old rows backfilled here.
-- idempotent, آمن للتكرار. قاعدة حاكمة: أي migration جديد يُدمج هنا.
-- =============================================================

-- workspace_sequences: atomic per-workspace sequence counter
CREATE TABLE IF NOT EXISTS workspace_sequences (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sequence_name text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, sequence_name)
);

-- channel_accounts: external provider identifiers (backfilled in W6-T1 from provider_accounts)
DO $$
BEGIN
  ALTER TABLE channel_accounts ADD COLUMN external_account_id text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE channel_accounts ADD COLUMN external_business_id text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE channel_accounts ADD COLUMN external_phone_id text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE channel_accounts ADD COLUMN health_status text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE channel_accounts ADD COLUMN last_health_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- conversations: lifecycle axes + display_id
DO $$
BEGIN
  ALTER TABLE conversations ADD COLUMN display_id integer;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD COLUMN lifecycle_state text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD COLUMN ai_substate text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD COLUMN labels text[] NOT NULL DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD COLUMN waiting_since timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE conversations ADD COLUMN first_reply_created_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Backfill display_id for existing rows (idempotent: only fills NULLs)
DO $$
DECLARE
  ws_record RECORD;
  conv_record RECORD;
  next_num bigint;
BEGIN
  FOR ws_record IN
    SELECT DISTINCT workspace_id FROM conversations WHERE display_id IS NULL
  LOOP
    INSERT INTO workspace_sequences (workspace_id, sequence_name, last_value)
    VALUES (ws_record.workspace_id, 'conversation_display_id', 0)
    ON CONFLICT (workspace_id, sequence_name) DO UPDATE
      SET last_value = GREATEST(
        workspace_sequences.last_value,
        COALESCE((
          SELECT MAX(display_id) FROM conversations
          WHERE workspace_id = ws_record.workspace_id AND display_id IS NOT NULL
        ), 0)
      );

    FOR conv_record IN
      SELECT id FROM conversations
      WHERE workspace_id = ws_record.workspace_id AND display_id IS NULL
      ORDER BY created_at, id
    LOOP
      UPDATE workspace_sequences
      SET last_value = last_value + 1
      WHERE workspace_id = ws_record.workspace_id
        AND sequence_name = 'conversation_display_id'
      RETURNING last_value INTO next_num;

      UPDATE conversations SET display_id = next_num WHERE id = conv_record.id;
    END LOOP;
  END LOOP;
END $$;

-- Add UNIQUE constraint after all rows have a display_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_conversations_ws_display_id'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT uq_conversations_ws_display_id UNIQUE (workspace_id, display_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conv_ws_display_id ON conversations(workspace_id, display_id);

-- Trigger: auto-assign display_id to new conversations atomically
CREATE OR REPLACE FUNCTION assign_conversation_display_id() RETURNS trigger AS $$
DECLARE
  next_num bigint;
BEGIN
  IF NEW.display_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO workspace_sequences (workspace_id, sequence_name, last_value)
  VALUES (NEW.workspace_id, 'conversation_display_id', 1)
  ON CONFLICT (workspace_id, sequence_name) DO UPDATE
    SET last_value = workspace_sequences.last_value + 1
  RETURNING last_value INTO next_num;
  NEW.display_id := next_num;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_conversations_display_id'
      AND tgrelid = 'public.conversations'::regclass
  ) THEN
    CREATE TRIGGER trg_conversations_display_id
      BEFORE INSERT ON conversations
      FOR EACH ROW EXECUTE FUNCTION assign_conversation_display_id();
  END IF;
END $$;

-- messages: typed messages (activated in W3-T2)
DO $$
BEGIN
  ALTER TABLE messages ADD COLUMN message_type text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE messages ADD COLUMN content_attributes jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- outbox_events: delivery-ledger link fields (activated in W4-T1)
DO $$
BEGIN
  ALTER TABLE outbox_events ADD COLUMN provider_account_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE outbox_events ADD COLUMN channel_account_id uuid
    REFERENCES channel_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE outbox_events ADD COLUMN failed_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── W2-T1: correlation_id on webhook_events ───────────────────────────────────
-- Links a received webhook_events row to the domain_events / outbox_events it
-- produces. NULL when INGEST_DEFERRED=false (inline processing, no correlation).

DO $$
BEGIN
  ALTER TABLE webhook_events ADD COLUMN correlation_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_webhook_events_correlation
  ON webhook_events(correlation_id)
  WHERE correlation_id IS NOT NULL;

SELECT 'MIGRATION_BUNDLE_APPLIED_SUCCESSFULLY' AS status;
