-- Billing patch: USD-canonical prices with optional local display overrides.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_usd numeric(10,2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_usd_annual numeric(10,2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_sar numeric(10,2);

UPDATE plans
SET price_usd = CASE
  WHEN key = 'trial' OR slug = 'trial' THEN 0
  WHEN key = 'starter' OR slug = 'starter' THEN 10
  WHEN key = 'growth' OR slug = 'growth' THEN 25
  WHEN key = 'business' OR slug = 'business' THEN 50
  ELSE COALESCE(price_usd, 0)
END
WHERE price_usd IS NULL;

UPDATE plans
SET price_usd_annual = round((price_usd * 12 * 0.8)::numeric, 2)
WHERE price_usd_annual IS NULL AND price_usd IS NOT NULL;

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS amount_currency text NOT NULL DEFAULT 'YER';
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS exchange_rate_snapshot jsonb;
