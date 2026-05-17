ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "trust_mode" text NOT NULL DEFAULT 'suggest';
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "trust_confidence_threshold" numeric(3,2) NOT NULL DEFAULT '0.80';
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "trust_topics" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "trust_blocklist" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "max_auto_replies_per_conversation" integer NOT NULL DEFAULT 3;
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "escalate_after_failed_auto" integer NOT NULL DEFAULT 1;
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "daily_auto_send_quota" integer NOT NULL DEFAULT 200;

CREATE TABLE IF NOT EXISTS "auto_reply_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "ai_agents"("id") ON DELETE cascade,
  "message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE cascade,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "confidence" numeric(3,2),
  "topic_detected" text,
  "sent_message_id" uuid REFERENCES "messages"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_auto_decisions_conv" ON "auto_reply_decisions"("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_auto_decisions_ws_day" ON "auto_reply_decisions"("workspace_id", "created_at");
