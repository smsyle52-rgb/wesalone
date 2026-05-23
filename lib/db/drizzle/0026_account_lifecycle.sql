-- Closure Phase 4B: email verification, password reset, workspace deactivation.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type
  ON auth_tokens(user_id, type, expires_at);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES users(id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deactivation_reason text;
