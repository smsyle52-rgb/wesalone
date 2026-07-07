import type pg from "pg";

/**
 * W4-T3: one claimer fans domain_events out to independent, idempotent
 * subscribers instead of each subscriber running its own competing poll.
 * Flag-gated (EVENT_DISPATCHER) — off by default, the legacy direct
 * agent-runner loop in index.ts is unchanged and untouched when disabled.
 *
 * Idempotency is tracked per (event, subscriber) in event_subscriber_progress,
 * independent of domain_events.status (which stays the single-consumer
 * summary field the legacy loop and cleanup queries already rely on).
 */

export type DispatchEventRow = {
  id: string;
  workspace_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  attempts: number;
};

export type EventSubscriber = {
  name: string;
  handler: (event: DispatchEventRow) => Promise<void>;
};

// Same scope as the legacy agent-runner claim query — the dispatcher does not
// widen which event types get claimed; it only generalizes *how* they're claimed.
const DISPATCHED_EVENT_TYPES = ["message.received", "message.echo"];

async function claimEventsForDispatch(pool: pg.Pool, limit: number): Promise<DispatchEventRow[]> {
  const { rows } = await pool.query<DispatchEventRow>(
    `
      UPDATE domain_events
      SET status='processing'
      WHERE id IN (
        SELECT id FROM domain_events
        WHERE status='pending' AND event_type = ANY($1)
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, workspace_id, event_type, entity_type, entity_id, payload, attempts
    `,
    [DISPATCHED_EVENT_TYPES, limit],
  );
  return rows;
}

async function subscriberAlreadyDone(pool: pg.Pool, eventId: string, subscriber: string): Promise<boolean> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM event_subscriber_progress WHERE event_id=$1 AND subscriber=$2 LIMIT 1",
    [eventId, subscriber],
  );
  return rows[0]?.status === "done";
}

async function recordSubscriberResult(
  pool: pg.Pool,
  eventId: string,
  subscriber: string,
  status: "done" | "failed",
  lastError: string | null,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO event_subscriber_progress (event_id, subscriber, status, attempts, last_error, processed_at)
      VALUES ($1, $2, $3, 1, $4, CASE WHEN $3 = 'done' THEN NOW() ELSE NULL END)
      ON CONFLICT (event_id, subscriber) DO UPDATE
      SET status = EXCLUDED.status,
          attempts = event_subscriber_progress.attempts + 1,
          last_error = EXCLUDED.last_error,
          processed_at = CASE WHEN EXCLUDED.status = 'done' THEN NOW() ELSE event_subscriber_progress.processed_at END
    `,
    [eventId, subscriber, status, lastError],
  );
}

export async function runEventDispatcher(params: {
  pool: pg.Pool;
  subscribers: EventSubscriber[];
  limit?: number;
  onEventDone: (eventId: string) => Promise<void>;
  onEventFailed: (eventId: string) => Promise<void>;
  logError: (err: unknown, context: Record<string, unknown>) => void;
}): Promise<void> {
  const events = await claimEventsForDispatch(params.pool, params.limit ?? 5);

  for (const event of events) {
    let allSubscribersDone = true;

    for (const subscriber of params.subscribers) {
      if (await subscriberAlreadyDone(params.pool, event.id, subscriber.name)) continue;
      try {
        await subscriber.handler(event);
        await recordSubscriberResult(params.pool, event.id, subscriber.name, "done", null);
      } catch (err) {
        allSubscribersDone = false;
        const message = err instanceof Error ? err.message : String(err);
        await recordSubscriberResult(params.pool, event.id, subscriber.name, "failed", message.slice(0, 500));
        params.logError(err, { eventId: event.id, subscriber: subscriber.name });
      }
    }

    if (allSubscribersDone) {
      await params.onEventDone(event.id);
    } else {
      await params.onEventFailed(event.id);
    }
  }
}
