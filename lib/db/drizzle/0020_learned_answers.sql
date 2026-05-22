-- Closure Phase 2D: safe learned answers for context injection
CREATE TABLE IF NOT EXISTS learned_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question_pattern text NOT NULL,
  best_answer text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  topic_sensitivity text NOT NULL DEFAULT 'simple',
  status text NOT NULL DEFAULT 'pending_review',
  confidence numeric(3,2) NOT NULL DEFAULT 0.70,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learned_answers_ws_status ON learned_answers(workspace_id, status);
