# Billing Closure Report

## Summary
Closure Phase 3 introduced a manual Yemeni billing and subscription layer for Wesal One. Prices are stored in the database through the `plans` table and can be changed without code changes. No automated payment gateway was added.

## Data Model
The billing model now includes:

- `plans`: plan key, Arabic name, monthly and annual YER prices, billing cycle, limits, features, active flag, and sort order.
- `subscriptions`: workspace subscription status, plan, trial dates, current period, payment method, and last payment reference.
- `usage_counters`: monthly workspace usage snapshot for messages, agents, contacts, and team members.
- `payment_submissions`: manual payment requests for Kuraimi, Jawali, bank transfer, or cash.

The deploy bundle `scripts/migrate-phase345.sql` includes the Phase 3 billing migration idempotently.

## Plans
Seeded plans:

- Trial: 14-day trial, broad feature access for onboarding.
- Starter: entry-level merchant plan.
- Growth: expanded plan for growing teams.
- Business: larger plan with higher limits and priority support.

Prices are canonical in USD through `plans.price_usd` and `plans.price_usd_annual`. YER and SAR are display currencies converted from the latest `exchange_rates` row unless an optional display override is set. Operators should adjust USD canonical prices in the database, and may optionally set local display overrides when needed.

## Trial Logic
New workspaces start with a 14-day trial subscription. The trial uses status `trialing` and records `trial_ends_at`.

## Limit Logic
Limit enforcement is soft by default:

- Monthly message and usage overages show warnings.
- Data remains preserved.
- Login remains available.

Hard caps are applied only when creating new agents or connecting new channels beyond the current plan limit.

## Grace And Expiry
The outbox worker runs daily billing maintenance:

- `active` subscriptions past `current_period_end` move to `grace`.
- `trialing` subscriptions past `trial_ends_at` move to `grace`.
- `grace` subscriptions older than seven days move to `expired`.

No destructive action is taken. Data is preserved.

## Manual Payment Flow
Merchant flow:

1. Merchant opens Settings → Billing.
2. Merchant reviews current plan, usage, available plans, and manual payment instructions.
3. Merchant chooses a display currency, reviews the converted price, and submits payment proof with amount, currency, method, reference, and note.
4. A `payment_submissions` row is created with status `pending`.

Admin flow:

1. Owner opens `/admin/payments`.
2. Owner confirms or rejects pending payment submissions.
3. Confirmation activates or extends the workspace subscription immediately.
4. Confirmation/rejection is logged through audit logs and domain events.

## How To Change Prices
Update the `plans` table directly:

- `price_usd`
- `price_usd_annual`
- `price_yer`
- `price_yer_annual`
- `price_sar`
- `limits`
- `features`
- `is_active`
- `sort_order`

No code change is required for pricing edits.

## Deferred
- Automated payment gateway.
- Automatic receipt image upload/storage.
- Public checkout.
- Tax invoice generation.
- Renewal reminders by SMS or WhatsApp.

## Verification
- `corepack pnpm -r typecheck`: PASS
- `corepack pnpm run build:prod`: PASS
