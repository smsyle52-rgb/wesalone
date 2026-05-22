-- Closure Phase 2C: safe handoff flags for knowledge gaps
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS needs_human boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalation_reason text;
CREATE INDEX IF NOT EXISTS idx_conv_ws_needs_human ON conversations(workspace_id, needs_human);
