-- W6-T2: end-to-end correlation id on domain_events, threaded from the live
-- Meta webhook POST handler. Additive, nullable.

DO $$
BEGIN
  ALTER TABLE domain_events ADD COLUMN correlation_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_domain_events_correlation
  ON domain_events(correlation_id);
