# Vendure order-process reference (behavior only)

- Upstream repository: `vendurehq/vendure`
- Commit: `c5a27854e6bf430792056b6311608c4e4d35c114`
- Source path: `packages/core/src/config/order/default-order-process.ts`
- License: GPLv3 by default, or a separate Vendure Commercial License.
- Copy decision: **not copied**. The code is not included because this project is not adopting GPLv3 or a Vendure commercial license.

## Behavior extracted and independently reimplemented

- Explicit transition map; terminal states do not accept arbitrary transitions.
- Validate order contents and current stock before progressing.
- Validate payment coverage before payment-dependent transitions.
- Couple state transitions with stock allocation and a permanent transition history.
- Reject transitions if fulfillment/inventory preconditions are not satisfied.
- Publish an event after a successful transition, not before the transaction succeeds.

## Wesal One target

- `artifacts/api-server/src/modules/commerce/commerce.constants.ts`
- `artifacts/api-server/src/modules/commerce/order-lifecycle.service.ts`
- `lib/db/src/schema/order_history.ts`
- `lib/db/drizzle/0018_commerce_orders_payments.sql`

The Wesal One implementation uses original TypeScript, PostgreSQL row locks, Drizzle/raw `pg`, server-derived workspace isolation, existing audit logs, and existing domain events. No NestJS, TypeORM, Vendure EventBus, GraphQL, or Vendure tenant/auth code is present.
