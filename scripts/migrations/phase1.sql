ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "agent_status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "agent_paused_until" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "consecutive_agent_replies" integer NOT NULL DEFAULT 0;

ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "default_agent_id" uuid;

ALTER TABLE "channel_accounts"
  ADD CONSTRAINT "channel_accounts_default_agent_id_ai_agents_id_fk"
  FOREIGN KEY ("default_agent_id")
  REFERENCES "ai_agents"("id")
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "domain_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
