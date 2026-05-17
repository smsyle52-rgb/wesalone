CREATE TABLE IF NOT EXISTS "service_heartbeats" (
  "service_name" text PRIMARY KEY,
  "last_beat_at" timestamptz NOT NULL DEFAULT now(),
  "version" text,
  "metadata" jsonb
);
