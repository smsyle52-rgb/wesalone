CREATE TABLE IF NOT EXISTS contact_channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE cascade,
  channel_account_id uuid NOT NULL REFERENCES channel_accounts(id) ON DELETE cascade,
  channel_type text NOT NULL,
  identity_type text NOT NULL,
  identity_value text NOT NULL,
  normalized_identity text NOT NULL,
  business_scope_id text,
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  provider_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_channel_identities_scope
  ON contact_channel_identities(workspace_id, channel_account_id, identity_type, normalized_identity);

CREATE INDEX IF NOT EXISTS idx_contact_channel_identities_contact
  ON contact_channel_identities(workspace_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_channel_identities_lookup
  ON contact_channel_identities(workspace_id, channel_type, identity_type, normalized_identity);

CREATE INDEX IF NOT EXISTS idx_contact_channel_identities_business_scope
  ON contact_channel_identities(workspace_id, channel_type, business_scope_id)
  WHERE business_scope_id IS NOT NULL;
