ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS idempotency_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_events_workspace_idempotency ON outbox_events(workspace_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_events_entity ON outbox_events(entity_type, entity_id);
