# 05 — File-Level Transformation Plan

> Action per file/module: **KEEP · MODIFY · SPLIT · MERGE · RENAME · DEPRECATE · DELETE · CREATE**.
> **Nothing was modified or deleted in this audit.** Any DELETE below is a *proposal* gated on the proof checklist at the bottom.
> Paths are relative to repo root. Chatwoot refs are **pattern** sources only (no code copied).

## A. Database schema (`lib/db/src/schema/`)

| Action | Current path | Target | Reason | Chatwoot ref | Risk | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| MODIFY | `conversations.ts` (conversations) | + `display_id`, `labels`, `waiting_since`, `first_reply_created_at`, `lifecycle_state`, `ai_substate` | display_id/labels/lifecycle parity (W4/W5) | `conversation.rb` | Med (writers) | lifecycle unit + isolation | additive cols; drop on rollback |
| MODIFY | `conversations.ts` (messages) | + `message_type` enum, `content_attributes` jsonb | typed messages + reply/quote (W8) | `message.rb` | Low | message render + ordering | additive cols |
| MODIFY | `integrations.ts` (`channel_accounts`) | absorb `provider_accounts` fields (external ids, health) | one channel model (W1) | `inbox.rb`+`channel/*` | High | channel CRUD + send | dual-read window |
| MODIFY | `outbox.ts` (`outbox_events`) | + `provider_account_id`, `channel_account_id`, `failed_at` | single outbox (W1) | jobs | Med | outbox send + retry | additive cols |
| KEEP | `contacts.ts`, `rbac.ts`, `inbox_ops.ts`, `users.ts`, `workspaces.ts`, `orders.ts`, `order_items.ts`, `payments.ts`, `products.ts`, `debts.ts`, `finance.ts`, `point_wallet.ts`, `billing.ts`, `knowledge.ts`, `ai.ts`, `agent_memory.ts`, `domain_events.ts`, `notifications.ts`, `tasks.ts`, `followups.ts`, `opportunities.ts`, `reports.ts`, `security.ts`, `service_health.ts`, `sectors.ts`, `templates.ts`, `tickets.ts`, `settings_ext.ts`, `files.ts` | — | Sound; in live use | — | — | regression | — |
| KEEP+WIRE | `integrations.ts` (`webhook_events`, `inbound_event_links`, `provider_delivery_attempts`, `dead_letter_events`, `idempotency_keys`, `integration_health_checks`, `integration_error_events`) | wire into live path | tables exist, unused live (W1/W2) | Sidekiq+source_id | Med | ingestion/replay/DLQ | feature-flag ingestion |
| DEPRECATE | `integrations.ts` (`provider_accounts`) | after backfill into `channel_accounts` | duplicate channel model (W1) | — | High | backfill verify | keep table until cutover proven |
| DEPRECATE | `integrations.ts` (`outbox_messages`) | after merge into `outbox_events` | duplicate outbox (W1) | — | Med | — | keep table; no writers added |
| KEEP (inert) | `catalog.ts` (`products`,`catalog_sources`,`ad_campaigns`) | — | superseded by `inventory_products`; removal is risk-without-reward (handoff) | — | — | — | — |

## B. API server — ingestion & integrations (`artifacts/api-server/src/modules`)

| Action | Current path | Target | Reason | Chatwoot ref | Risk | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| MODIFY | `webhooks/meta.routes.ts` | persist `webhook_events` + correlation id, **then** fast-ack; move normalization into adapters; keep HMAC | durable + fast-ack (W2) | `webhooks/*` controllers | High | webhook replay/dup/contract | flag `INGEST_DEFERRED`; old inline path behind flag |
| SPLIT | `webhooks/meta.routes.ts` (inline `handleMetaPayload`/`upsert*`) | → `integrations/adapters/whatsapp.adapter.ts` | one normalization layer per provider | `*IncomingMessageBuilder` | Med | adapter unit | adapters callable by old path too |
| KEEP/MODIFY | `integrations/meta-webhook.handler.ts`, `meta-channel-ingest.ts`, `instagram.handler.ts`, `messenger.handler.ts` | fold into adapters (IG/Messenger) | consolidate 3-channel normalization | builders | Med | adapter unit | — |
| KEEP+WIRE | `integrations/webhookIngest.service.ts`, `idempotency.service.ts`, `integrationLedger.service.ts`, `integrationHealth.service.ts` | become the live ingestion/ledger services | already written; just unwired (W1) | — | Med | service unit | flagged |
| DECIDE | `integrations/webhooks.routes.ts` (unmounted) | mount as the live ingestion route **or** DELETE | currently dead (W1/W10) | — | Low | — | git revert |
| KEEP | `integrations/integrations.routes.ts` (ledger read/replay), `integrationTypes.ts` | point replay at live log | — | — | Low | replay test | — |
| MODIFY | `routes/index.ts` | mount one ingestion entry; keep order (webhookLimiter→apiLimiter) | single mounted path | — | Low | smoke | revert line |

## C. API server — conversations, assignment, messages

| Action | Current path | Target | Reason | Chatwoot ref | Risk | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| SPLIT | `modules/conversations/conversations.routes.ts` (~970 lines, 11 endpoints) | → `conversations.routes.ts` (HTTP) + `conversation.service.ts` (logic) + `lifecycle.ts` (state machine) + `assignment.ts` | testable lifecycle/assignment (W4/W6) | `conversation.rb` concerns | Med | lifecycle, assign, isolation | keep routes; extract behind same signatures |
| CREATE | `modules/conversations/lifecycle.ts` | the single state-machine owner (§6 doc 04) | fixes PD-11/W4 | `AssignmentHandler` | Med | lifecycle unit | flag `UNIFIED_LIFECYCLE` |
| CREATE | `modules/conversations/assignment.ts` (+ subscriber) | manual+auto assignment, availability | W6 | `AutoAssignmentHandler` | Med | assignment unit | off by default |
| CREATE | `modules/conversations/labels.ts` | conversation labels CRUD | W5 | `Labelable` | Low | label test | additive |
| MODIFY | `lib/agent-reply.ts`, `lib/agent-tools.ts` | call lifecycle for handoff transitions; **no tool/runtime redesign** | unify handoff only (W4) | `agent_bot` | Med | handoff test | preserve current returns |
| KEEP | `lib/ai-provider.ts`, `lib/ai-safety.ts`, `lib/model-router.ts`, `lib/contactTimeline.ts`, `lib/audit.ts`, `lib/seed.ts`, `lib/session.ts`, `lib/storage.ts`, `lib/rateLimiter.ts` | — | sound; preserve AI/safety/billing | — | — | regression | — |
| KEEP | `middlewares/*`, `middleware/idempotency.ts` | — | authz/isolation solid (S1/S3) | Pundit | — | authz test | — |

## D. Worker (`artifacts/outbox-worker/src`)

| Action | Current path | Target | Reason | Chatwoot ref | Risk | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| SPLIT | `index.ts` (~890 lines) | → `outbox-sender.ts`, `agent-runner.ts`, `event-dispatcher.ts`, `ingestion-dispatcher.ts`, `senders/{whatsapp,instagram,messenger}.ts`, `cleanup.ts`, `index.ts` (bootstrap) | maintainability + dispatcher (W7) | jobs/listeners | Med | per-loop unit | extract preserving behavior |
| CREATE | `event-dispatcher.ts` | one claimer fans `domain_events` to subscribers | resolves agent vs automation contention (W7) | `event_dispatcher_job.rb` | High | dispatch idempotency | flag; fall back to agent-runner-only |
| CREATE | `ingestion-dispatcher.ts` | claims `webhook_events(received)` → adapter → emit domain_events | deferred durable ingest (W2) | `*IncomingMessageService` | High | ingest/replay | flagged |
| MODIFY+WIRE | `automation-engine.ts` | become an automation **subscriber** of the dispatcher (not a competing poller) | orphaned + race risk (W7) | `automation_rule_listener` | Med | automation unit | off by default |
| KEEP (inert) / DECIDE | `agent-learning.ts`, `billing-maintenance.ts` | wire as subscribers **or** DEPRECATE | orphaned, low impact | — | Low | — | — |

## E. Realtime

| Action | Current path | Target | Reason | Chatwoot ref | Risk | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| MODIFY | `lib/events.ts` | back `emitWorkspaceEvent`/SSE with Postgres `LISTEN/NOTIFY` | multi-instance safe (W3) | `action_cable_listener` | Med | multi-instance e2e | keep EventEmitter as local fast-path |
| CREATE | `lib/realtime.ts` | LISTEN/NOTIFY bridge | enables `--max-instances>1` | ActionCable | Med | reconnect test | flag `REALTIME_PUBSUB` |

## F. Web (`artifacts/web/src`)

| Action | Scope | Reason | Risk |
|---|---|---|---|
| KEEP | All pages incl. recent mobile redesign (`InboxPage.tsx`, `SettingsPage.tsx`) | UI freeze; backend-first transformation | — |
| MODIFY (late waves only) | Inbox to show labels, display_id, unified status, assignment | surface new backend capabilities | Low, last |

## G. Deploy / migration plumbing

| Action | Path | Reason |
|---|---|---|
| MODIFY | `scripts/migrate-phase345.sql` | merge each new `00NN_*.sql` (idempotent) — **mandatory** (raw drizzle files are not auto-applied; caused PD-12) |
| MODIFY | `cloudbuild.yaml` `verify-migration` | assert new **columns** not just tables (PD-12 class) |
| KEEP | `Dockerfile`, `Dockerfile.worker`, `cloudbuild.worker.yaml` | per-package COPY discipline; `.dockerignore` source-collision caution |

---

## Deletion proof checklist (required before any DELETE/DEPRECATE removal)

A file/table may be removed **only** when all hold and are recorded in the task:
1. **Unused/duplicated/obsolete** — proven by grep across `artifacts/**`, `lib/**`, `scripts/**` (no importer, no route mount, no worker poll, no migration/seed reference).
2. **No runtime dependency** — not in `routes/index.ts`, not polled by the worker, not referenced by `migrate-phase345.sql` or `cloudbuild*.yaml`.
3. **Replacement exists and is live** (dual-read/backfill complete for tables).
4. **Rollback path** — `git revert` for code; for tables, the column/table is retained (not dropped) for ≥1 wave after writers are removed, then dropped in a separate, reversible migration.

Current removal candidates and their proof status:
- `integrations/webhooks.routes.ts` — (1) unmounted **[V]**, (2) **[U] confirm no other import**, (3) replaced by wired ingestion, (4) git revert. → **DECIDE in Wave 2.**
- `provider_accounts` — 2026-07-07 re-verified: **fails (1),(2),(3)**. Live reader+writer:
  `integrationLedger.service.ts` (list/get/create/update/disableProviderAccount) is called from
  `integrations.routes.ts`, mounted at `/integrations` in `routes/index.ts:73`. `channels.routes.ts`
  still runs on a separate `channelAccountsTable` in parallel — W6-T1 backfill/cutover has not run
  (no backfill DML in `migrate-phase345.sql`, only empty nullable columns added). → **NOT SAFE TO
  DROP. Keep W8-T1 blocked until W6-T1 ships and cutover is proven.**
- `outbox_messages` — 2026-07-07 re-verified: **passes (1),(2),(3)**. Zero references anywhere in
  `artifacts/**`/`lib/**`/`scripts/**` outside schema declaration + migration DDL; outbox-worker's
  live send loop exclusively uses `outbox_events`; FK child `provider_delivery_attempts` is also
  zero-referenced. **(4) unmet** — no dated deprecation checkpoint exists to measure "retained ≥1
  wave" against, since W6-T1 never formally marked it deprecated. → **DEPRECATE confirmed dead in
  code; still no DROP until a recorded deprecation wave has elapsed.** (W8-T1 is scoped as one
  action across both objects, so this alone does not unblock W8-T1.)
- `agent-learning.ts`, `billing-maintenance.ts` — orphaned **[V]**; decide wire-vs-deprecate in Wave 5.
- second WhatsApp handler `handleMetaWhatsAppWebhook` — **[U] locate & prove dead** before delete.
