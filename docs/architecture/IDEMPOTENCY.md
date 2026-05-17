# Idempotency

Khadamatak accepts an optional `Idempotency-Key` header for selected mutation routes.

Initial scope:

- `/api/payments/*`
- `/api/orders/*`
- `/api/integrations/outbox/*`

The middleware records the key, workspace, route scope, response hash, response status, and cached response body in `idempotency_keys`. Entries expire after 24 hours.

Behavior:

- First request with a key is marked `processing`.
- A repeated key while the first request is still running returns `409`.
- A repeated completed key returns the cached response with `Idempotency-Status: replayed`.
- Failed server responses are marked `failed` so they can be retried intentionally.

This guard is intentionally limited to financially sensitive and integration outbox routes. Future expansion can cover more mutation endpoints after each route's side effects are reviewed.
