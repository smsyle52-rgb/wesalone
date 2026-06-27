-- =============================================================
-- 0030_parity_columns — Wave 1: Additive Chatwoot-parity columns
-- All columns are nullable/defaulted; no live behavior change.
-- New rows get display_id via trigger; old rows backfilled.
-- IMPORTANT: merge this idempotently into scripts/migrate-phase345.sql
-- idempotent, safe to re-run (IF NOT EXISTS + EXCEPTION WHEN duplicate_column)
-- =============================================================

-- ── workspace_sequences: atomic per-workspace sequence counter ───────────────
CREATE TABLE IF NOT EXISTS workspace_sequences (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sequence_name text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, sequence_name)
);

-- ── channel_accounts: external provider identifiers (backfilled W6-T1) ───────
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

-- ── conversations: lifecycle axes + display_id ────────────────────────────────
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

-- ── Backfill display_id for existing rows (idempotent: only fills NULLs) ─────
DO $$
DECLARE
  ws_record RECORD;
  conv_record RECORD;
  next_num bigint;
BEGIN
  FOR ws_record IN
    SELECT DISTINCT workspace_id FROM conversations WHERE display_id IS NULL
  LOOP
    -- Seed the sequence from any already-assigned display_ids in this workspace
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

    -- Assign sequential IDs in insertion order
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

-- Add UNIQUE constraint only after all rows have a display_id
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

-- ── Trigger: auto-assign display_id to new conversations ─────────────────────
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

-- ── messages: typed messages (read in W3-T2) ──────────────────────────────────
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

-- ── outbox_events: delivery-ledger link fields (used in W4-T1) ───────────────
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

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT 'VERIFY_0030: workspace_sequences' AS check
WHERE EXISTS (
  SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'workspace_sequences'
);

SELECT 'VERIFY_0030: display_id column' AS check
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'display_id'
);
