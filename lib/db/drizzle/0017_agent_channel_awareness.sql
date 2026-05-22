-- Closure Phase 2A: channel-aware agent behavior
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS channel_tone jsonb NOT NULL DEFAULT '{}'::jsonb;
