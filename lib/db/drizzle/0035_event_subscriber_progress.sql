-- W4-T3: per-subscriber idempotent progress tracking for the event-dispatcher.
-- Additive only; used exclusively behind the EVENT_DISPATCHER flag.

CREATE TABLE IF NOT EXISTS event_subscriber_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  subscriber text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_subscriber_progress_event_subscriber
  ON event_subscriber_progress(event_id, subscriber);

CREATE INDEX IF NOT EXISTS idx_event_subscriber_progress_status
  ON event_subscriber_progress(status);
