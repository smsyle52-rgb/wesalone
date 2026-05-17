ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS temperature numeric(4, 2) NOT NULL DEFAULT 0.30;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS max_output_tokens integer NOT NULL DEFAULT 1024;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS knowledge_base_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
