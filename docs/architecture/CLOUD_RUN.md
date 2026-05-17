# Cloud Run Operations

## API service

- Liveness probe: `/api/livez`, period 10 seconds.
- Readiness probe: `/api/readyz`, period 5 seconds, failure threshold 3.
- Concurrency: 80.
- Min instances: 0. Cold starts are acceptable for the API.
- CPU: request-based allocation.
- Timeout: 300 seconds to keep Server-Sent Events friendly.

## Outbox worker

- Service name: `khadamatak-outbox-worker`.
- Min instances: 1. The worker must keep polling outbox and domain events.
- CPU: always allocated.
- Health endpoint: `/healthz`.
- Heartbeat: writes `service_heartbeats.service_name = 'outbox-worker'` every 15 seconds.

## Readiness contract

`/api/readyz` returns ready only when:

- The API can run `SELECT 1` against Postgres within one second.
- The outbox worker heartbeat is newer than 60 seconds.

If the worker is stale, readiness returns `503` with `reason: "outbox-worker-stale"`.
