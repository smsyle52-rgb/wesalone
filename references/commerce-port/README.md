# Commerce source port: Medusa + Vendure → Wesal One

## Retrieval record

The official repositories were read through GitHub's repository API at pinned commits. The full repositories are not committed into Wesal One; only selected, task-relevant references are retained here.

| Source | Official repository | Branch | Pinned commit | License | Decision |
|---|---|---|---|---|---|
| Medusa | https://github.com/medusajs/medusa | `develop` | `7686adc8637b41879c4551ca422829ad2d63d6a9` | MIT | Selected small model files may be copied/trimmed with the MIT notice. Runtime behavior is rewritten for Express/Drizzle/PostgreSQL. |
| Vendure | https://github.com/vendurehq/vendure | `master` | `c5a27854e6bf430792056b6311608c4e4d35c114` | GPLv3 by default or separate VCL | No Vendure source code is copied. Only source paths and behavior notes are retained; implementation is original to avoid imposing GPLv3 on Wesal One. |

## Medusa files selected

| Upstream path | Direct dependencies | Purpose | Retained reference | Wesal One target | Port decision |
|---|---|---|---|---|---|
| `packages/modules/product/src/models/product.ts` | Medusa model utilities and product relations | Product status, images, variants | Recorded in this manifest; only relevant fields were used | `lib/db/src/schema/products.ts` | Rewrite behavior; keep current product table |
| `packages/modules/product/src/models/product-variant.ts` | Medusa model utilities, product/options/images | Stable variant, SKU, barcode and options | `medusa/packages/modules/product/src/models/product-variant.ts` | `lib/db/src/schema/product_variants.ts` | Copied/trimmed reference, original Drizzle implementation |
| `packages/modules/inventory/src/models/inventory-level.ts` | Medusa model utilities, InventoryItem | Per-location stocked/reserved/incoming/available | `medusa/packages/modules/inventory/src/models/inventory-level.ts` | `lib/db/src/schema/stock_locations.ts` | Copied/trimmed reference; available is generated in PostgreSQL |
| `packages/modules/inventory/src/models/reservation-item.ts` | Medusa model utilities, InventoryItem | Reservation linked to line item and location | Source inspected at pinned commit | `lib/db/src/schema/inventory_reservations.ts` | Rewrite with order/workspace/idempotency fields |
| `packages/modules/stock-location/src/models/stock-location.ts` | Medusa model utilities, address model | Named stock locations | `medusa/packages/modules/stock-location/src/models/stock-location.ts` | `lib/db/src/schema/stock_locations.ts` | Copied/trimmed reference; add Wesal location types |
| `packages/modules/order/src/models/line-item.ts` | Medusa model utilities, tax/adjustment models | Product/variant links plus historical snapshot | Source inspected at pinned commit | `lib/db/src/schema/order_items.ts` | Rewrite into existing order item table |
| `packages/modules/payment/src/models/payment.ts` | Payment collection/session, capture, refund | Independent payment records | Source inspected at pinned commit | `lib/db/src/schema/payments.ts` | Rewrite into existing payment table |
| `packages/modules/payment/src/models/refund.ts` | Payment and refund reason | Refund tied to payment | Source inspected at pinned commit | `payment_refunds` migration + commerce payment routes | Rewrite |

## Vendure files selected (behavior only)

| Upstream path | Direct dependencies | Behavior used | Wesal One target |
|---|---|---|---|
| `packages/core/src/config/order/default-order-process.ts` | NestJS services, TypeORM connection, event bus, order/payment/stock services | Explicit state transitions; validate contents, stock, payments and fulfillment before transition; write history after success | `commerce.constants.ts`, `order-lifecycle.service.ts`, `order_state_transitions` |
| `packages/core/src/service/services/stock-movement.service.ts` | NestJS, TypeORM, stock level/location services, event bus | Allocation reserves; release restores availability; sale decreases reserved and on-hand; cancellation/return restores on-hand; each change has a movement | `inventory-reservation.service.ts`, `inventory-consumption.service.ts`, `inventory_movements` |
| `packages/core/src/entity/stock-movement/allocation.entity.ts` | TypeORM entities | Allocation movement identity | `InventoryMovementType = Allocation/Reservation` |
| `packages/core/src/entity/stock-movement/release.entity.ts` | TypeORM entities | Release allocated stock | `Release` movement |
| `packages/core/src/entity/stock-movement/sale.entity.ts` | TypeORM entities | Negative on-hand sale movement | `Sale` movement |
| `packages/core/src/entity/stock-movement/cancellation.entity.ts` | TypeORM entities | Restore stock for cancellation | `Cancellation` movement |
| `packages/core/src/entity/payment/payment.entity.ts` | TypeORM order/payment relations | Multiple payment records and state | Existing `payments` table |
| `packages/core/src/entity/refund/refund.entity.ts` | TypeORM payment relation | Refund linked to payment | New `payment_refunds` table |
| `packages/core/src/entity/order-line/order-line.entity.ts` | TypeORM product variant/order relations | Line points to stable product variant and retains pricing | Existing `order_items` table extended |

Vendure notes are retained under `vendure/packages/.../*.reference.md`. Vendure code was not copied because the default license is GPLv3 and the plugin exception does not make core server files permissive.

## Existing Wesal One audit and final mapping

| Existing file | Confirmed weakness | Imported rule/model | Final implementation |
|---|---|---|---|
| `lib/db/src/schema/products.ts` | One SKU/price/quantity on product | Medusa product/variant separation | Product remains; variants added in `product_variants.ts`; quantity becomes legacy-only |
| `artifacts/api-server/src/modules/products/products.routes.ts` | Client can submit price and directly change one quantity field | Server-owned variant price and per-location stock | Commerce product routes are mounted first; legacy unmatched routes remain temporarily |
| `lib/db/src/schema/order_items.ts` | Optional product link, no variant/location, unstructured snapshot | Medusa line snapshot | Adds product variant, location, tax, snapshot and reservation status |
| `orders.routes.ts` | State update does not alter inventory | Vendure transition guards and stock side effects | Commerce order routes and lifecycle service are mounted first |
| `payments.routes.ts` | Legacy pending/confirmed flow, no refund records | Separate payment/refund records and coverage recalculation | Commerce payment routes are mounted first; legacy unmatched endpoints remain |
| No location/level/reservation/movement tables | Overselling and no audit trail | Medusa inventory levels + Vendure movements | New workspace-scoped tables and append-only movement trigger |

## Removed source architecture

No Medusa or Vendure server, ORM, authentication, tenant model, GraphQL layer, plugin runtime, admin application, event bus or deployment configuration is included. The final code uses Wesal One sessions and permissions, Express, PostgreSQL, Drizzle/raw `pg`, existing audit logs, existing domain events and server-derived `workspaceId`.
