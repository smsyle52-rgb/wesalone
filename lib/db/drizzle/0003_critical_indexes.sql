CREATE INDEX IF NOT EXISTS idx_contacts_ws ON contacts(workspace_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_ws_created ON contacts(workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conv_ws_status ON conversations(workspace_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conv_ws_assigned ON conversations(workspace_id, assigned_membership_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conv_ws_lastmsg ON conversations(workspace_id, last_message_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages(conversation_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_msg_ws_provider ON messages(workspace_id, provider_message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tickets_ws_status ON tickets(workspace_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_ws_status_due ON tasks(workspace_id, status, due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_followups_ws_sched ON followups(workspace_id, scheduled_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_orders_ws_status ON orders(workspace_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payments_ws_status ON payments(workspace_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status, next_attempt_at);
--> statement-breakpoint
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_msgs_status ON outbox_messages(status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_ws_created ON audit_logs(workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contact_channels_normalized ON contact_channels(workspace_id, channel_type, normalized_identifier);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS method text;
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS path text;
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_status int;
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_body jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_workspace_key ON idempotency_keys(workspace_id, key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
