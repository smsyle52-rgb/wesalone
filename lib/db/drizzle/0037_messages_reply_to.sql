-- W3-T2: reply/quote threading. No FK — the quoted message may be pruned
-- independently; this is a soft reference for rendering only.

DO $$
BEGIN
  ALTER TABLE messages ADD COLUMN reply_to_message_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
