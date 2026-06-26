# 09 — Test & Validation Strategy

> Uses the **actual** tooling in this repo. No invented commands.

## Available commands (verified)
- Typecheck (all): `corepack pnpm run typecheck` (root) — tsc build + per-artifact typecheck. **[V]**
- Production build: `corepack pnpm run build:prod`. **[V]**
- Unit tests (where they exist today): vitest in `artifacts/api-server` and `lib/ui` → `corepack pnpm --filter @workspace/api-server test`, `corepack pnpm --filter @workspace/ui test` (`"test":"vitest run"`). **[V]**
- Existing test dir: `artifacts/api-server/src/__tests__`. **[V]**
- No e2e/browser runner is configured today (PLANS.md baseline: "No unit/component/browser test script exists" beyond the UI package). New suites must register a `test` script in the relevant package so CI/local can run them. **[V]**

> Gap to close in Wave 1: add a `test` script to `outbox-worker` (vitest) and broaden `api-server` coverage. Keep everything runnable via `corepack pnpm -r --if-present run test`.

## Test layers and what each wave must add

### Unit tests
- **Lifecycle state machine** (`lifecycle.ts`): every transition incl. PD-11 reopen → emits fresh event; status/agent_status projections correct. (Wave 3)
- **Provider adapters** (`whatsapp/instagram/messenger.adapter.ts`): given a recorded payload, produce the right contact/conversation/message + idempotency key. (Wave 2)
- **Assignment** (`assignment.ts`): round-robin picks only `online` memberships; reset-bot-on-assign. (Wave 5)
- **Outbox payload builder/sender**: each `message.send.*` shape maps to the right Graph call (mock `fetch`). (Wave 4)
- **Currency/tool coercion** in `agent-tools.ts` (regression guard for PD-9). (any wave touching tools)

### Integration tests (DB-backed, vitest + a test Postgres)
- Inbound → `webhook_events` persisted → dispatcher → `domain_events` → `/internal/agent-reply` mocked → `outbox_events` written. (Wave 2/3)
- Conversation CRUD + label + assign + status through the service layer with a real workspace. (Wave 3)

### Contract tests (highest ROI — guards the PD-6 outage class)
- WhatsApp `entry[].changes[].value.messages[]` vs IG/Messenger `entry[].messaging[]` → both normalize correctly; signature verification accept/reject. (Wave 1, expanded Wave 2)
- Event envelopes (domain/outbox/realtime) match doc 07 schemas (zod parse round-trip). (Wave 2+)
- Internal API response shapes (`/internal/agent-reply`) unchanged. (Wave 2)

### Webhook-replay tests
- Re-POST the same Meta payload twice → exactly one message, one domain event (dedup on `provider_message_id` + `webhook_events UNIQUE`). (Wave 2)
- Replay a `dead_letter_events` row → reprocesses without duplication. (Wave 2/6)

### Duplicate-event tests
- Two worker instances claim overlapping `domain_events`/`outbox_events` → `FOR UPDATE SKIP LOCKED` guarantees single processing; `onConflictDoNothing`/unique idempotency prevents double send. (Wave 4)

### Tenant-isolation tests (currently MISSING — make it a standing suite)
- Seed workspace A and B. For **every** read/list/detail endpoint and every new column, assert a B-session can never see A's rows by id/filter. Include conversations, messages, contacts, channels, labels, outbox, webhook_events. (Wave 1, extended each wave)
- Webhook isolation: a payload for A's `phone_number_id` never creates rows under B.

### Assignment tests
- Manual assign writes membership + activity message; auto round-robin distribution is even across online agents; offline agents skipped; reassignment on going-offline. (Wave 5)

### Permission tests
- Matrix from doc 11/SKILL: each role × protected route → allow/deny matches the permission matrix; object-level scoping (agent sees only own/team) where enabled. (Wave 3/5)

### Message-ordering tests
- Concurrent inbound + outbound persist with monotonic `created_at`/sequence; UI list ordering stable; no interleave corruption. (Wave 3/4)

### Retry & failure tests
- Outbox: provider 500 → retry at 60s·n, permafail at 3 → `dead_letter`/escalate-to-human + CRITICAL alert. (Wave 4)
- Ingestion: adapter throw → `webhook_events.status=failed` → retry → DLQ. (Wave 2)
- 24h WhatsApp window expiry → escalate, no send. (Wave 4)

### Human/AI handoff tests
- Escalation keyword / tool failure / human-assign → `human_controlled`, bot stops auto-send.
- Reactivate-agent → `ai_active` + fresh event → bot replies (PD-11). (Wave 3)
- AI-authored message persists `sender_id=null, sender_name=agent.name` (PD-7 guard). (Wave 3)

### Load & concurrency tests
- Burst N inbound across M workspaces; assert no cross-tenant leak, no duplicate replies, dispatcher keeps up, realtime fan-out under `LISTEN/NOTIFY` with 2 instances. Establish a baseline before lifting `max-instances`. (Wave 4)

### Deployment smoke tests (post-deploy, every wave)
- `/api/readyz` ok; worker heartbeat fresh (`service_heartbeats`); webhook GET verify echoes challenge; **one real inbound WhatsApp → reply arrives** (the protection invariant); Cloud Build `verify-migration` (now column-aware) passed.

## CI gating recommendation
- Block merge on: typecheck + build:prod + unit + contract + tenant-isolation suites.
- Run integration/load on demand (need a Postgres service) before high-risk waves (2,4,5).
