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
  'catalog_sources','products','social_posts','ad_campaigns','catalog_sync_runs'
)
ORDER BY tablename;

COMMIT;

-- Print final status
SELECT 'MIGRATION_BUNDLE_APPLIED_SUCCESSFULLY' AS status;
