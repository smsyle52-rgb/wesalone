---
name: wesal-chatwoot-transformation
description: >
  Canonical operating contract for evolving Wesal One toward Chatwoot-equivalent
  inbox/conversation/channel/webhook/assignment/permission maturity — inside Wesal's
  existing TypeScript/React/PostgreSQL/Drizzle stack. Use for ANY implementation task
  under docs/architecture/chatwoot-parity. Execute exactly ONE task id from
  sonnet-task-graph.yaml at a time. Do not improvise outside the approved task. Stop and
  report if the repo differs from the audited baseline.
---

# Wesal One ↔ Chatwoot Parity — Implementation Contract

## Mission
Give Wesal One the architectural maturity and behavior of Chatwoot in: unified inbox,
conversations & messages, contacts, channel accounts, WhatsApp/Instagram/Messenger,
webhook ingestion, event processing & workers, human assignment, teams & memberships,
roles & permissions, human/AI handoff, conversation lifecycle, labels/notes/internal
collaboration, automations, and operational stability — **without** changing Wesal's
technology, product identity, AI agents, orders/payments/inventory, Meta integrations,
or Arabic/RTL experience.

## Fixed architectural objective (already approved — do not re-debate)
Translate Chatwoot's **verified domain behaviors, boundaries, invariants and operational
patterns** into Wesal's existing code. **One** inbox model, **one** inbound event log,
**one** outbox, **one** conversation lifecycle, **one** event dispatcher with many
independent subscribers. Consolidate duplicates; never add a parallel system.

## Current repository stack (audited)
- pnpm monorepo (`pnpm@10.33.2`), Node 24. `artifacts/{api-server,outbox-worker,web,landing-next}` + `lib/{db,ui,api-spec,api-zod,api-client-react}`.
- Express 5 API + Meta webhook + SSE; single-file outbox-worker (4 loops); React 19 + Vite; Drizzle + PostgreSQL (Cloud SQL); Cloud Run via Cloud Build on push to `main`.
- Live loop: `POST /api/webhooks/meta → domain_events → /internal/agent-reply → outbox_events → Meta Graph`.
- Audited base SHA: `3aa394c267569e335ee9142223c76bb47af17a47` (branch `fix/mobile-reference-redesign`).

## Chatwoot reference (patterns only)
- `github.com/chatwoot/chatwoot` @ `develop` `d0b1c055e8fa40ab19e4898ed6cf1aafd24431fc`.
- **Legal/license boundary:** open core is MIT. **Never** copy, derive from, or depend on
  `enterprise/`, Captain, or any `include_mod_with` Enterprise module. Adapt **patterns**
  re-expressed in TypeScript; never translate Ruby/Vue verbatim. Do not add Chatwoot as a
  submodule/dependency or commit its source.

## Domain invariants (must hold after every task)
1. **Tenant isolation:** every query is scoped by `workspace_id`, always derived server-side
   from the session (or, for webhooks, from the matched `channel_account`). Never from
   request body/params.
2. **Live inbound→reply never breaks** — a real WhatsApp message must still get a reply after
   each deploy (the protection smoke test).
3. **AI-authored messages** persist `sender_id=null, sender_name=agent.name` (PD-7). Never regress.
4. **Idempotency:** inbound dedup by `provider_message_id`; outbox unique `(workspace_id, idempotency_key)`; claims use `FOR UPDATE SKIP LOCKED`.
5. **Safety governors stay:** anti-loop (`consecutive_agent_replies`), echo-pause, escalation keywords, tool-failure→silent human escalation, 24h WhatsApp window. Preserve all.
6. **Secrets** live only in Secret Manager / env / encrypted `*_secret_ref`; never in code, logs, or these docs. Meta app `1437258534807702` is untouched unless the owner explicitly asks.

## Tenant-isolation rules
- New column/table → carries `workspace_id`; new query → filters on it.
- Add/extend the isolation suite for anything you touch (workspace A cannot read B).
- Prefer the session's `activeWorkspaceId`; for cross-membership actions verify membership (403 otherwise).

## API & event rules
- Contracts are **additive + versioned**; never remove a field mid-wave. Uniform error
  `{ error, code, requiredPermission? }`; never leak stack traces.
- Keep `/internal/agent-reply` request/response stable. Keep the `outbox_events` payload
  contract (`to, channelAccountId, text|mediaUrl|template…`) stable — the worker depends on it.
- Event envelopes carry `v` and (from Wave 2) a `correlation_id`. Subscribers are idempotent on `(eventId, subscriber)`.
- Full contract reference: `docs/architecture/chatwoot-parity/07-api-event-contracts.md`.

## Webhook rules
- Verify HMAC `x-hub-signature-256` (timingSafeEqual) before any processing; fail-closed on processing.
- Target: **persist `webhook_events` (dedup on UNIQUE(provider, idempotency_key)) → fast-ack 200 → defer** to the ingestion dispatcher → provider adapter normalizes → emit `domain_events`. Failures → retry → `dead_letter_events`. Behind `INGEST_DEFERRED` until cutover.
- Contract-test both payload shapes: WhatsApp `entry[].changes[]` vs IG/Messenger `entry[].messaging[]` (PD-6 regression class).

## Assignment rules
- Manual assign writes `assigned_membership_id` + an activity message + emits `conversation.assigned`.
- Auto-assignment is per-channel policy (off | round_robin), online/capacity filtered, default OFF.
- **Assigning a human stops AI auto-send** (Chatwoot `reset_agent_bot_when_assignee_present`).

## Human/AI handoff rules
- One lifecycle: `lifecycle_state ∈ {new,open,pending,resolved,snoozed}` × `ai_substate ∈ {ai_active,ai_paused,human_controlled,ai_blocked}`, owned by `modules/conversations/lifecycle.ts` — the **only** writer of `status`/`agent_status` (now projections).
- Reactivate-to-bot **must emit a fresh inbound-class event** so the dispatcher re-engages (PD-11 fix). Status flip alone is the bug.

## File & module boundaries
- KEEP (do not redesign): AI runtime (`lib/agent-reply.ts`, `agent-tools.ts`, `ai-provider.ts`, `ai-safety.ts`, `model-router.ts`), RBAC middleware, orders/payments/inventory, billing/points, knowledge/retrieval.
- CONSOLIDATE (the core work): `channel_accounts`+`provider_accounts`→one; `domain_events`/`webhook_events` durable ingest; `outbox_events`+`outbox_messages`→one; orphaned `automation-engine.ts` → dispatcher subscriber.
- Full action list (KEEP/MODIFY/SPLIT/MERGE/RENAME/DEPRECATE/DELETE/CREATE):
  `docs/architecture/chatwoot-parity/05-file-transformation-plan.md`.
- **Deletion requires proof** (unused + no runtime dep + replacement live + rollback) recorded in the task. Deprecate-before-drop; retain tables ≥1 wave.

## Migration waves (dependency-ordered)
0 docs · 1 additive columns+tests · 2 durable deferred ingestion · 3 unified lifecycle + typed
messages + labels · 4 one outbox + delivery ledger + realtime pub/sub + dispatcher · 5 auto-assignment
+ automations subscriber + presence · 6 observability/retention/channel cutover · 7 UI surfacing ·
8 drop deprecated schema. Details + acceptance/rollback per wave:
`docs/architecture/chatwoot-parity/08-migration-waves.md`.

## Migration mechanism (mandatory — PD-12 footgun)
- Author `lib/db/drizzle/00NN_*.sql` **AND merge it idempotently into `scripts/migrate-phase345.sql`**.
  Raw drizzle files are **not** auto-applied; the merged file is what Cloud Build runs before deploy.
- Additive-first, backfill, dual-read, flip behind a flag, deprecate, then drop in a later reversible wave.
- Extend `cloudbuild.yaml` `verify-migration` to assert new **columns**, not just tables.
- Watch `.dockerignore` source-collisions (PD-13): a new code dir named like an ignore rule
  (`uploads`, `secrets`, `dist`) is silently dropped from the build — add an explicit `!` un-ignore.

## Validation commands (real — do not invent)
- `corepack pnpm run typecheck`
- `corepack pnpm run build:prod`
- `corepack pnpm --filter @workspace/api-server test` · `corepack pnpm --filter @workspace/ui test`
- (add a `test` script to a package before adding its suite; aim for `corepack pnpm -r --if-present run test`)
- Post-deploy smoke: `/api/readyz` ok, worker heartbeat fresh, webhook GET verify echoes challenge, one real inbound→reply arrives.
- Strategy: `docs/architecture/chatwoot-parity/09-test-strategy.md`.

## Definition of done (per task)
- The single task's acceptance criteria in `sonnet-task-graph.yaml` are met.
- typecheck + build:prod pass; required tests (incl. tenant-isolation for touched surfaces) green.
- New SQL merged into `migrate-phase345.sql`; `verify-migration` updated if columns added.
- Feature-flagged; rollback verified; live inbound→reply smoke passes.
- No secret/PII in code, logs, or docs. No change outside the task's declared files.

## Forbidden changes
- A second inbox, user, or tenant system; a second source of truth for conversations.
- Copying Chatwoot DB structures unmapped to Wesal domains; copying Ruby/Vue/Enterprise code.
- Introducing Rails/Vue, Kafka/RabbitMQ/microservices, or mandatory Redis/Sidekiq unless a
  load test proves Postgres `LISTEN/NOTIFY` + the existing worker insufficient.
- Redesigning the AI agent runtime or its 5 business tools (`create_order`, `log_payment_claim`,
  `schedule_followup`, `send_product_media`, `handoff_to_human`).
- Weakening HMAC/webhook verification; removing working code without dependency proof.
- Big-bang migrations; dropping tables in the same wave that introduces their replacement.
- `git add -A`, committing, or pushing — **owner pushes by hand** (push to `main` = prod deploy).

## Rollback requirements
- Every behavioral change is behind a feature flag with a verified off-path.
- Schema is additive-first; deprecated objects are retained ≥1 wave; drops are reversible (Wave 8).
- Code rollback = `git revert` (owner). Never reset/clean/stash existing work.

## Execution protocol
1. Read this skill + the 12 docs under `docs/architecture/chatwoot-parity/`.
2. Confirm the repo matches the audited base SHA and that the working tree has no unexpected
   divergence (check `git log` for unreviewed Cursor commits, esp. escalation/safety). If the
   repo differs materially from the audited state, **stop and report** before changing code.
3. Take **exactly one** task id from `sonnet-task-graph.yaml` (start: `W1-T1`). Respect its
   `dependencies`, `files_to_*`, `do_not_touch`, and `acceptance_criteria`. Do not improvise
   beyond the task.
4. Implement → typecheck + build:prod + required tests → update the task `status` → write a
   short closure note → **hand to the owner to commit/push**. One scope per session.

## Architecture document index
- `01-current-state-audit.md` — verified strengths/weaknesses/dups, evidence.
- `02-chatwoot-reference-map.md` — Chatwoot domains, patterns to adapt / avoid, license boundary.
- `03-parity-matrix.md` — capability-by-capability classification.
- `04-target-architecture.md` — the end-state design.
- `05-file-transformation-plan.md` — per-file actions + deletion-proof checklist.
- `06-database-migration-plan.md` — additive/backfill/dual-read/rollback sequencing.
- `07-api-event-contracts.md` — stable, versioned API/event contracts.
- `08-migration-waves.md` — dependency-ordered, flagged, acceptance/rollback per wave.
- `09-test-strategy.md` — real commands + test layers per wave.
- `10-risk-register.md` — ranked risks + Chatwoot patterns NOT to copy.
- `sonnet-task-graph.yaml` — the executable task list (one at a time).
