-- Closure Phase 2E: lightweight Yemeni location context without maps API
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS location_note text;
