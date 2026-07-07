-- W4-T1: provider_delivery_attempts must key off the live outbox model (outbox_events),
-- not the deprecated outbox_messages (zero live writers, see W8-T1 proof in
-- docs/architecture/chatwoot-parity/05-file-transformation-plan.md). Additive only:
-- outbox_message_id becomes nullable (never populated again), new outbox_event_id added.

DO $$
BEGIN
  ALTER TABLE provider_delivery_attempts ALTER COLUMN outbox_message_id DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE provider_delivery_attempts ADD COLUMN outbox_event_id uuid REFERENCES outbox_events(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_delivery_attempts_outbox_event
  ON provider_delivery_attempts(outbox_event_id);
