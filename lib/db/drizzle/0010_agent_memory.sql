CREATE TABLE IF NOT EXISTS "agent_memory_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "agent_id" uuid REFERENCES "ai_agents"("id") ON DELETE set null,
  "summary" text,
  "recent_turns" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_message_id" uuid,
  "token_estimate" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_memory_conv_agent" ON "agent_memory_snapshots" ("conversation_id", "agent_id");
CREATE INDEX IF NOT EXISTS "idx_memory_ws_conv" ON "agent_memory_snapshots" ("workspace_id", "conversation_id");
