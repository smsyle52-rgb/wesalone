# 01 — Wesal One Current-State Audit

> Read-only audit. No application code, schema, dependency, or deployment file was modified to produce this document.
> Evidence labels: **[V]** Verified (read directly in this audit) · **[I]** Inferred (reasoned from partial evidence) · **[U]** Unverified (needs a follow-up read before relying on it).

## Baseline

| Item | Value | Source |
|---|---|---|
| Wesal One branch | `fix/mobile-reference-redesign` | `git rev-parse` **[V]** |
| Wesal One HEAD | `3aa394c267569e335ee9142223c76bb47af17a47` | `git rev-parse HEAD` **[V]** |
| Working tree | clean except one **untracked** file `.claude/launch.json` | `git status --short` **[V]** |
| Chatwoot reference | `github.com/chatwoot/chatwoot` · branch `develop` · `d0b1c055e8fa40ab19e4898ed6cf1aafd24431fc` (2026-06-25) | shallow clone in scratchpad, read-only, **not** added to repo **[V]** |
| Runtime | Node v24.14.1 (package `engines` unset); pnpm `10.33.2` via `packageManager` | `node -v`, root `package.json` **[V]** |
| Monorepo | pnpm workspaces: `artifacts/*` (api-server, outbox-worker, web, landing-next, mockup-sandbox) + `lib/*` (db, ui, api-spec, api-zod, api-client-react) | `pnpm-workspace.yaml`, dir listing **[V]** |
| Build/typecheck | `pnpm run typecheck` (tsc build + per-artifact), `pnpm run build:prod` | root `package.json` scripts **[V]** |
| Tests | **vitest** present in `artifacts/api-server` and `lib/ui` only (`"test": "vitest run"`); `api-server/src/__tests__` exists | grep of package.json **[V]** |
| DB / deploy | PostgreSQL (Cloud SQL) + Drizzle ORM; two Cloud Run services (api-server, outbox-worker) deployed by Cloud Build on push to `main` | `cloudbuild.yaml`, `Dockerfile*`, handoff **[V]/[I]** |

> **Working-tree note (mandated):** `.claude/launch.json` is present and untracked. It was **not** touched, staged, or committed. All other tracked files are unmodified.

---

## 1. Architecture at a glance (verified)

**Request/runtime topology:**

- `artifacts/api-server` — Express 5 HTTP API + Meta webhook receiver + SSE realtime. Routes registered in `artifacts/api-server/src/routes/index.ts`. **[V]**
- `artifacts/outbox-worker` — single-file Node poller (`src/index.ts`) with four loops: outbox sender (3s), agent runner (5s), heartbeat (10s), cleanup (300s). **[V]**
- `artifacts/web` — React 19 + Vite dashboard. **[V]**
- `lib/db` — Drizzle schema + client (`@workspace/db`); 37 schema files under `lib/db/src/schema`. **[V]**

**The live message loop (verified end-to-end):**

```
Meta → POST /api/webhooks/meta (modules/webhooks/meta.routes.ts)
     → HMAC verify (timingSafeEqual) → upsertContact → upsertConversation
     → insertInboundMessage (dedup by provider_message_id)
     → INSERT domain_events('message.received')
outbox-worker.runAgentRunner (5s): claim domain_events FOR UPDATE SKIP LOCKED
     → POST /internal/agent-reply (X-Internal-Secret)
     → runAgentReply() → INSERT outbox_events('message.send.<channel>.<kind>')
outbox-worker.runOutboxSender (3s): poll outbox_events WHERE event_type LIKE 'message.send.%'
     → Meta Graph API send → mark done / retry(3, 60s·n backoff) / escalate-to-human on permafail
```
Evidence: `meta.routes.ts:380-445` (domain event creation), `outbox-worker/src/index.ts:533-554` (sender), `:556-573` (claim), `:799-814` (handoff). **[V]**

---

## 2. Verified strengths (preserve these)

| # | Strength | Evidence | Why it matters |
|---|---|---|---|
| S1 | **Server-derived tenant isolation.** `workspaceId` is *always* taken from the session (`req.session.user.activeWorkspaceId`), never from body/params; ~140 id-scoped queries pair `eq(id)` with `eq(workspaceId)`. | `lib/events.ts:49`, handoff Domain 2 audit, `requireSession.ts` | The hardest property to retrofit; Wesal already has it. |
| S2 | **Mature integration *schema*** already models webhook idempotency, delivery attempts, dead-letter, health, and per-account secret refs. | `lib/db/src/schema/integrations.ts` (`webhook_events`, `outbox_messages`, `provider_delivery_attempts`, `dead_letter_events`, `idempotency_keys`, `integration_health_checks`) **[V]** | Chatwoot-parity infra largely *exists as tables*; the gap is wiring, not design. |
| S3 | **Granular custom RBAC** (roles, permissions, role_permissions, membership_roles, teams, team_members) — finer than Chatwoot **open-core** (which ships only agent/administrator; custom roles are Chatwoot Enterprise). | `lib/db/src/schema/rbac.ts`, `requirePermission.ts` (100+ permission slugs) **[V]** | Wesal is **higher capability** here than the reference's open core. |
| S4 | **Idempotent inbound + outbound.** Inbound dedup by `provider_message_id` (`meta.routes.ts:344-354`); outbound `outbox_events` unique `(workspace_id, idempotency_key)` + 3-try backoff + permafail escalation. | `meta.routes.ts`, `outbox-worker/src/index.ts:145-179` **[V]** | No duplicate replies; matches Chatwoot's `source_id`/job idempotency intent. |
| S5 | **Anti-loop + safety governors** on the agent: `consecutive_agent_replies >= 2` → pause; `message.echo` → pause; escalation keywords; tool-failure → silent human escalation; 24h WhatsApp window enforcement. | `outbox-worker/src/index.ts:671-814`, `agent-reply.ts:25,365-370` **[V]** | These are bespoke invariants Chatwoot does **not** have; must not be lost in any refactor. |
| S6 | **Three Meta channels generalized** in send + receive (WhatsApp/Instagram/Messenger) with per-channel routing. | `outbox-worker/src/index.ts:439-528`, `modules/integrations/meta-webhook.handler.ts` **[V]** | Core product surface; working in production. |
| S7 | **Rich inbox-ops tables already present**: `quick_replies` (canned responses), `saved_views` (custom filters/folders), `sla_rules`, `business_hours`. | `lib/db/src/schema/inbox_ops.ts` **[V]** | Several are Chatwoot **Enterprise** features (SLA); schema already exists. |
| S8 | **Domain bus + outbox pattern** with `FOR UPDATE SKIP LOCKED` claiming and structured CRITICAL alerts for log-based alerting. | `outbox-worker/src/index.ts:556-573,79-81` **[V]** | Correct concurrency primitive; foundation for parity is sound. |

---

## 3. Verified weaknesses / gaps (ranked)

| # | Severity | Weakness | Evidence | Target (Chatwoot parity) |
|---|---|---|---|---|
| W1 | **Critical** | **Dual, divergent channel + event + outbox systems.** Live path uses `channel_accounts` + `domain_events` + `outbox_events`. A second, *more sophisticated* system (`provider_accounts` + `webhook_events` + `outbox_messages` + `dead_letter_events`) exists in `modules/integrations/*` but its ingestion entry (`webhooks.routes.ts → ingestWebhookEvent`) is **not mounted** in `routes/index.ts`. Two sources of truth for "a connected channel" and "an inbound event". | grep: `outboxMessagesTable`/`webhookEventsTable`/`providerAccountsTable` referenced **only** inside `modules/integrations/`; `routes/index.ts` mounts `integrations.routes` (ledger read/replay) but never `webhooks.routes`. **[V]** | One inbox/channel model, one inbound-event log, one outbox. (Chatwoot: `Inbox`+`Channel::*`, jobs, one delivery path.) |
| W2 | **High** | **No durable inbound-event log in the live path.** `POST /meta` does all work synchronously *then* returns 200; on exception it only `logger.error`s — the event is lost, not retried, not replayable. The `webhook_events` table that would fix this is the unused W1 system. | `meta.routes.ts:551-577` (catch → log only) **[V]** | Fast-ack + persist raw event + deferred job + DLQ + replay (Chatwoot `*::IncomingMessageService` via Sidekiq). |
| W3 | **High** | **Realtime does not scale past one instance.** SSE fan-out is an in-process `EventEmitter`; Cloud Run is pinned `--max-instances=1`. Horizontal scale would drop events for clients on other instances. | `lib/events.ts:23-36` (in-memory `EventEmitter`); handoff H8-3d **[V]** | External pub/sub (Postgres `LISTEN/NOTIFY` or Redis) so realtime survives multi-instance. (Chatwoot: ActionCable + Redis.) |
| W4 | **High** | **Conversation lifecycle has two uncoordinated axes** (`status` *and* `agent_status`) and a documented reopen bug (PD-11): reopening flips `status` but the worker gates on `agent_status='human'`, so the bot stays silent. No single state machine. | `conversations.ts:33-46`, handoff PD-11 **[V]** | One explicit, tested lifecycle that unifies human status + AI status (see doc 04 §Handoff). |
| W5 | **Medium** | **No conversation labels and no human-facing conversation number.** `conversations` has no labels/tags column and no `display_id` (per-workspace sequential). Contacts have `tags`; conversations have none. | `conversations.ts` (no label/display_id columns) vs Chatwoot `cached_label_list`, `display_id` UNIQUE(account_id,display_id) **[V]** | Add conversation labels + per-workspace sequential `display_id`. |
| W6 | **Medium** | **No assignment automation / presence.** Assignment is manual only (`PATCH /:id/assign`); no round-robin, capacity, agent availability/online state, or assignment audit trail. | `conversations.routes.ts:507`; no auto_assignment service exists **[V]** | Auto-assignment policy per inbox + agent presence (Chatwoot `AutoAssignmentHandler`, `assignment_policy`). |
| W7 | **Medium** | **Automations engine is orphaned.** `automation-engine.ts` exists in the worker but is **not imported** in `worker/index.ts`; if wired naively it would race the agent-runner for the same `domain_events` rows. `agent-learning.ts` and `billing-maintenance.ts` are likewise orphaned. | handoff Domain 9; `worker/index.ts` imports none of them **[V]** | A single dispatcher that routes events to bot vs automation without contention (Chatwoot listeners + dedicated jobs). |
| W8 | **Medium** | **Message model lacks reply/quote + typed message classes.** No `in_reply_to`/quoted-message linkage; `senderType` is a free text column, not an enum; no `message_type` (incoming/outgoing/activity/template) distinct from `direction`. Activity/system messages are not first-class. | `conversations.ts:60-86` **[V]** | `message_type` enum + `content_attributes`/`in_reply_to` (Chatwoot `Message#message_type`, `content_attributes`). |
| W9 | **Low/Med** | **Contact identity is workspace+channelType scoped, not channel-account scoped.** `contact_channels` unique key is `(workspace_id, channel_type, normalized_identifier)`. Two WhatsApp numbers (two inboxes) for the same end-user phone collapse to one channel row; conversation separately stores `channelAccountId`. | `contacts.ts:57-62` vs Chatwoot `contact_inboxes` UNIQUE(inbox_id, source_id) **[V]** | Decide: keep workspace-scoped identity (acceptable) but make the conversation↔contact_channel↔channel_account relationship a documented invariant. |
| W10 | **Low** | **Two WhatsApp inbound implementations.** `handleMetaPayload` (live) and `handleMetaWhatsAppWebhook` (dead from the route). Maintenance duplication. | handoff Domain 4 note **[V/I]** | Delete the dead one after dependency proof. |

---

## 4. Duplicated / conflicting paths (consolidated list)

| Pair | Live | Parallel/Dormant | Action class (see doc 05) |
|---|---|---|---|
| Channel model | `channel_accounts` (`integrations.ts`/`conversations.ts`) | `provider_accounts` + `provider_secret_refs` | MERGE → one inbox/channel model |
| Inbound event | `domain_events` | `webhook_events` (+ `inbound_event_links`) | MERGE → durable inbound log feeding domain bus |
| Outbox | `outbox_events` (worker-driven) | `outbox_messages` (+ `provider_delivery_attempts`) | MERGE → one outbox with attempts ledger |
| DLQ / idempotency | inline in `outbox_events.attempts` | `dead_letter_events`, `idempotency_keys` | KEEP tables, WIRE into live path |
| Webhook ingestion route | `modules/webhooks/meta.routes.ts` | `modules/integrations/webhooks.routes.ts` (unmounted) | Reconcile; one mounted ingestion entry |
| WhatsApp inbound handler | `handleMetaPayload` | `handleMetaWhatsAppWebhook` (dead) | DELETE dead after proof |

---

## 5. Dead / obsolete / suspicious files (candidates — deletion requires doc 05 proof)

- `modules/integrations/webhooks.routes.ts` — imports `ingestWebhookEvent` but route is **not** mounted. **[V] unmounted**, **[U] fully dead** (confirm no other importer).
- `outbox-worker/src/automation-engine.ts`, `agent-learning.ts`, `billing-maintenance.ts` — present, **not imported** by `index.ts`. **[V] not wired**.
- `modules/catalog/*` + `schema/catalog.ts` (`products`, `catalog_sources`, `ad_campaigns`) — Meta catalog backend not mounted; superseded by `inventory_products`. Kept inert intentionally (handoff). **[V/I]**.
- Second WhatsApp handler `handleMetaWhatsAppWebhook` — **[U]** (locate and confirm).

---

## 6. Missing tests / missing contracts

- **No contract tests** for the Meta webhook payloads (WhatsApp `changes[]` vs IG/Messenger `messaging[]`); regressions here have caused outages (PD-6). **[V]**
- **No tenant-isolation test suite** — isolation is asserted by manual review only (handoff Domain 2). **[V]**
- **No webhook-replay / duplicate-event tests**; idempotency is exercised only in production. **[V]**
- **No assignment / handoff lifecycle tests**; PD-7/PD-11 were caught live, not by tests. **[V]**
- vitest exists but coverage is minimal (`api-server/src/__tests__`, `lib/ui`). **[V]**
- **No OpenAPI/published contract** for internal APIs or the realtime/outbox event envelopes (`lib/api-spec`, `lib/api-zod` exist but coverage unverified). **[U]**

---

## 7. Audit-area summary (for the parity matrix, doc 03)

| Area | One-line current state | Evidence |
|---|---|---|
| Tenant boundaries | Solid, session-derived `workspace_id` everywhere | `requireSession.ts`, handoff D2 |
| Inbox/channel accounts | Works via `channel_accounts`; duplicated by `provider_accounts`; no health surfaced from live path | `integrations.ts`, W1 |
| Contacts | `contacts` + `contact_channels` + notes + timeline; dedup by normalized id | `contacts.ts` |
| Conversations | Present; dual status axes; no labels/display_id/participants | `conversations.ts`, W4/W5 |
| Messages | Present; no reply/quote, no typed message classes, free-text sender | `conversations.ts`, W8 |
| Webhooks/ingestion | Live but synchronous, no durable log/replay in live path | `meta.routes.ts`, W2 |
| Outbound delivery | Robust retry/backoff/escalate; attempts ledger table unused | `worker/index.ts`, W1 |
| Teams/assignment | Teams + memberships exist; assignment manual only | `rbac.ts`, W6 |
| Permissions | Granular custom RBAC, route-level enforcement | `requirePermission.ts`, S3 |
| Realtime | SSE in-process EventEmitter, single instance | `lib/events.ts`, W3 |
| Automations | Engine exists but orphaned | handoff D9, W7 |
| Observability | CRITICAL log alerts, heartbeat, audit log; no correlation id end-to-end | `worker/index.ts`, `lib/audit.ts` |
| Retention/deletion | Soft-delete (archive); no hard-erasure endpoint (PDPL gap noted) | handoff D7 |
| AI/human handoff | Bespoke `agent_status` machine + escalation; not unified with `status` | `agent-reply.ts`, W4 |
