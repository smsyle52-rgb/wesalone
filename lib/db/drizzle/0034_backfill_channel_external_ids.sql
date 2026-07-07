-- W6-T1: backfill channel_accounts.external_{account,business,phone}_id from each row's own
-- provider_config jsonb (already the live source of truth — no cross-table matching, no
-- cross-tenant risk). Only fills NULLs; never overwrites a value a live write path already set.

UPDATE channel_accounts
SET external_phone_id = COALESCE(external_phone_id, provider_config->>'phone_number_id', provider_config->>'phoneNumberId')
WHERE channel_type = 'whatsapp' AND external_phone_id IS NULL;

UPDATE channel_accounts
SET external_business_id = COALESCE(external_business_id, provider_config->>'waba_id', provider_config->>'wabaId')
WHERE channel_type = 'whatsapp' AND external_business_id IS NULL;

UPDATE channel_accounts
SET external_account_id = COALESCE(external_account_id, provider_config->>'igAccountId')
WHERE channel_type = 'instagram' AND external_account_id IS NULL;

UPDATE channel_accounts
SET external_account_id = COALESCE(external_account_id, provider_config->>'pageId')
WHERE channel_type = 'messenger' AND external_account_id IS NULL;
