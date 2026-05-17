# Outbox Worker

`@workspace/outbox-worker` is a separate Cloud Run service that processes rows from `outbox_events`.

Lifecycle:

1. The worker polls every 5 seconds.
2. It claims up to 25 pending rows with `FOR UPDATE SKIP LOCKED`.
3. It dispatches by `event_type`.
4. Successful events are marked `sent`.
5. Failed events are retried with exponential backoff.
6. Events move to `dead_letter` after 6 failed attempts.

Retry policy:

- Attempt 1 retry delay: 2 minutes.
- Attempt 2 retry delay: 4 minutes.
- Attempt 3 retry delay: 8 minutes.
- Attempt 4 retry delay: 16 minutes.
- Attempt 5 retry delay: 32 minutes.
- Attempt 6 moves to `dead_letter`.

Current dispatchers:

- `message.send.whatsapp`: stubbed when Meta credentials are not configured. If Meta credentials are configured, it posts to the Meta Graph API.
- Unknown event types are marked `failed` with the reason recorded in the payload metadata.

Cloud Run deployment:

- Service name: `khadamatak-outbox-worker`.
- Minimum instances: `1` so polling does not stop.
- CPU is always allocated using `--no-cpu-throttling`.
- The worker exposes `/healthz` and returns `{ ok: true, processed_last_minute: N }`.

Migration path:

When traffic exceeds roughly 1,000 outbound messages per minute, move from polling to Cloud Tasks or Pub/Sub push:

- API writes the outbox row.
- API enqueues a task containing the outbox event ID.
- Worker receives push requests and processes one event per request.
- Keep the same retry and dead-letter statuses in Postgres for auditability.
