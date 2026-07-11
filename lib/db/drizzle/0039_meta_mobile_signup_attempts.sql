CREATE TABLE IF NOT EXISTS meta_mobile_signup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_attempt_id text NOT NULL,
  nonce_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_key text NOT NULL,
  config_id text NOT NULL,
  return_to text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  checkpoint text NOT NULL DEFAULT 'pending',
  claim_token text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  encrypted_token_ref text,
  discovered_options jsonb,
  channel_account_id uuid REFERENCES channel_accounts(id) ON DELETE SET NULL,
  result_ready boolean NOT NULL DEFAULT false,
  retry_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_mobile_signup_attempt_id
  ON meta_mobile_signup_attempts(signup_attempt_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_mobile_signup_nonce_hash
  ON meta_mobile_signup_attempts(nonce_hash);
CREATE INDEX IF NOT EXISTS idx_meta_mobile_signup_workspace_status
  ON meta_mobile_signup_attempts(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_meta_mobile_signup_lease
  ON meta_mobile_signup_attempts(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_meta_mobile_signup_expires
  ON meta_mobile_signup_attempts(expires_at);
