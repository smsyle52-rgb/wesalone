# Billing operations

Wesal One uses the workspace owner's `PointWallet` as the points pool and the
owner's `UserQuota` as the plan-entitlement projection. `PlatformSubscription`
is the subscription lifecycle source of truth. Do not edit balances or quota
rows directly.

## Safe rollout

1. Deploy the code with `AI_POINTS_ENFORCEMENT_MODE=off`.
2. Apply the reviewed `drizzle-wesal` migrations only after explicit approval.
3. Run the read-only audit:

   ```bash
   pnpm --filter @chatbotx.io/database audit:billing
   ```

   To gate only accounts created after a new-account rollout, pin the rollout
   timestamp and keep it unchanged across every comparison:

   ```bash
   BILLING_AUDIT_CREATED_AFTER=2026-07-29T00:00:00Z \
     pnpm --filter @chatbotx.io/database audit:billing
   ```

   This scope intentionally ignores legacy owners, but it never changes or
   repairs them. The unscoped audit remains the source for historical cleanup.

4. Repair every critical issue reported by the audit with a separately reviewed,
   idempotent backfill. Re-run the audit until `ok` is `true`.
5. Deploy the worker with the Cloud Build substitution
   `_AI_POINTS_ENFORCEMENT_MODE=shadow`. Keep shadow mode for at least one full
   traffic cycle and compare usage totals with provider invoices and telemetry.
6. Resolve stale reservations and pending settlements. Confirm that every
   high-cost path appears in the pricing usage breakdown.
7. Deploy with `_AI_POINTS_ENFORCEMENT_MODE=enforce` and monitor insufficient
   balance errors, pending settlements, and provider-cost variance.

Never move directly from `off` to `enforce`. Never run a production migration
from an automated agent or as an implicit deployment step.

## Idempotency and reconciliation

- One provider operation must keep one stable `operationId` across retries.
- Credits require a stable grant `idempotencyKey`; debits use
  `usage:<operationId>`.
- `PointGrant.remainingMicroPoints` is the live balance authority.
- `PointLedger` is append-only and must reconcile to each grant.
- The hourly billing lifecycle releases stale reservations, retries pending
  settlements, advances monthly grants, and completes scheduled cancellations.
- Annual subscriptions receive their included points monthly, not all at once.

## Cancellation

Paid subscriptions can be scheduled for cancellation at period end and resumed
before that time. Annual subscriptions continue receiving monthly allowances
until the paid period ends. At cancellation completion the owner receives a new
free-plan period and exactly one idempotent free monthly grant.
