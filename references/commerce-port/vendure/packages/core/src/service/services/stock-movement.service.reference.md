# Vendure stock-movement reference (behavior only)

- Upstream repository: `vendurehq/vendure`
- Commit: `c5a27854e6bf430792056b6311608c4e4d35c114`
- Source path: `packages/core/src/service/services/stock-movement.service.ts`
- Related entity paths: `allocation.entity.ts`, `release.entity.ts`, `sale.entity.ts`, `cancellation.entity.ts`, `stock-adjustment.entity.ts`.
- License: GPLv3 by default, or a separate Vendure Commercial License.
- Copy decision: **not copied**; behavior was independently reimplemented.

## Behavior extracted

- Allocation increases the quantity unavailable for other sales.
- Release decreases allocated/reserved stock without decreasing on-hand stock.
- Sale decreases both the allocated quantity and on-hand quantity.
- Cancellation or return increases on-hand stock where appropriate.
- Every balance change produces a movement record and an event.
- Adjustment stores a delta rather than silently replacing movement history.
- Location selection is explicit and movements remain tied to the order line.

## Wesal One target

- `artifacts/api-server/src/modules/commerce/inventory-reservation.service.ts`
- `artifacts/api-server/src/modules/commerce/inventory-consumption.service.ts`
- `lib/db/src/schema/inventory_movements.ts`
- `lib/db/src/schema/inventory_reservations.ts`
- `lib/db/src/schema/stock_locations.ts`

The replacement uses a single PostgreSQL transaction and `SELECT ... FOR UPDATE`. It writes append-only movement rows and uses idempotency keys and correlation IDs.
