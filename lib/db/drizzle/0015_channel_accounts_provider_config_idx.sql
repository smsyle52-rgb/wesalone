CREATE INDEX IF NOT EXISTS idx_channel_accounts_phone_id
ON channel_accounts
USING gin(provider_config);
