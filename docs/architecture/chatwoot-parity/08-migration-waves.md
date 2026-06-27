# 08 — Migration Waves

> Dependency-ordered, each wave independently deployable, preserves production behavior, feature-flagged, with acceptance + rollback. **Foundational invariants before UI.** Owner pushes every commit (push to `main` = prod deploy).

Global gates for **every** wave:
- `corepack pnpm run typecheck` ✅ and `corepack pnpm run build:prod` ✅.
- New SQL merged into `scripts/migrate-phase345.sql` (idempotent) — not just a loose `drizzle/00NN`.
- Tenant-isolation assertion for any new column/table/query.
- Live smoke: a real inbound WhatsApp message → reply still arrives (the non-negotiable protection).

---

### Wave 0 — Documentation & guardrails (no code/schema)
**Scope:** these 12 docs + the canonical skill + flags scaffolding plan. Confirm repo matches audited SHA `3aa394c`.
**Acceptance:** docs merged; team aligned on invariants. **Rollback:** n/a. **Flag:** none.

### Wave 1 — Consolidation map + safety net (schema additive, no behavior change)
**Depends:** 0. **Scope:** add additive columns (`conversations.display_id/lifecycle_state/ai_substate/labels/waiting_since/first_reply_created_at`, `messages.message_type/content_attributes`, `outbox_events.*`, `channel_accounts.external_*`) **written but not read**; backfill `display_id` (atomic) + projections; extend `verify-migration` to columns; add the **tenant-isolation test harness** + **webhook contract tests** (WhatsApp `changes[]`, IG/Messenger `messaging[]`).
**Acceptance:** new columns populated on new rows; backfill counts match; isolation + contract tests green; zero behavior change live. **Rollback:** columns nullable/ignored; revert code. **Flag:** `WRITE_PARITY_COLUMNS`.

### Wave 2 — Durable, deferred ingestion (resolves W2; foundation for W1 dedup)
**Depends:** 1. **Scope:** `POST /meta` persists `webhook_events` (+correlation id) and **fast-acks**; new `ingestion-dispatcher` (worker) claims `received` rows → provider **adapters** (split out of `meta.routes.ts`) → upsert + emit `domain_events` → `processed`; failures → retry → `dead_letter_events`; wire `webhookIngest/idempotency/ledger` services; point `integrations.routes` replay at the live log; mount exactly one ingestion route, DECIDE on `webhooks.routes.ts`.
**Shadow mode:** run durable path in parallel (compare counts) before flipping primary.
**Acceptance:** inbound still delivered; every inbound has a `webhook_events` row + correlation id; forced failure lands in DLQ and replays; dup delivery deduped. **Rollback:** `INGEST_DEFERRED=false` → old inline path. **Flag:** `INGEST_DEFERRED`.

### Wave 3 — Unified conversation lifecycle + typed messages + labels (resolves W4/W5/W8/PD-11)
**Depends:** 1. **Scope:** `lifecycle.ts` state machine becomes the **only** writer of `status`/`agent_status` (now projections of `lifecycle_state`/`ai_substate`); fix reactivate-agent to emit a fresh inbound-class event; `message_type`/`content_attributes` reads enabled (reply/quote); conversation labels CRUD + filter; activity messages on assign/resolve; align priority vocabulary.
**Acceptance:** PD-11 reproduction is fixed by test (reopen → bot re-engages); handoff/escalation paths unchanged in behavior but now single-sourced; labels usable; reply-quote renders. **Rollback:** `UNIFIED_LIFECYCLE=false` → legacy dual-axis writers. **Flag:** `UNIFIED_LIFECYCLE`.

### Wave 4 — One outbox + delivery ledger + realtime pub/sub (resolves W1-outbox/W3)
**Depends:** 1,2. **Scope:** merge useful `outbox_messages` columns into `outbox_events` (already the live writer); feed `provider_delivery_attempts` on every send; reconcile delivery-receipt webhooks → `messages.delivery_status`; back realtime with Postgres `LISTEN/NOTIFY` (`lib/realtime.ts`) so `--max-instances` can exceed 1; the **event-dispatcher** replaces multiple loops polling `domain_events`.
**Acceptance:** sends unchanged; each send has an attempts row; delivery status updates from receipts; two app instances both receive realtime; dispatcher idempotency proven. **Rollback:** `REALTIME_PUBSUB=false` (in-process), keep `max-instances=1`; dispatcher flag falls back to agent-runner-only. **Flags:** `REALTIME_PUBSUB`, `EVENT_DISPATCHER`.

### Wave 5 — Assignment automation + automations subscriber + presence (resolves W6/W7)
**Depends:** 3,4. **Scope:** agent `availability` on membership; per-channel `assignment_policies` (off|round_robin) + availability/capacity filter; `assignmentSubscriber`; re-home `automation-engine.ts` as an **automation subscriber** of the dispatcher (no competing poll) with loop guards + audit; optional `conversation_participants`; object-level authz scoping for agents.
**Acceptance:** round-robin assigns to online agents only; assigning a human stops AI auto-send (reset-bot invariant); automations fire without racing agent replies; assignment changes audited. **Rollback:** policies default off; subscriber flag off. **Flags:** `AUTO_ASSIGNMENT`, `AUTOMATIONS_WIRED`.

### Wave 6 — Observability, retention, channel consolidation cutover (resolves W1-channel, W7-cleanup, retention)
**Depends:** 2,4. **Scope:** end-to-end correlation tracing surfaced; health/error events fed from live path + surfaced in `channels` UI; backfill `provider_accounts`→`channel_accounts`, flip reads, **DEPRECATE** `provider_accounts`/`outbox_messages` (retain tables); right-to-erasure path + credential cleanup on disconnect; decide wire-vs-deprecate for `agent-learning`/`billing-maintenance`; last-seen/SLA timing.
**Acceptance:** one channel model read everywhere; trace from webhook→reply by correlation id; erasure removes a contact's PII on request; deprecated tables have zero writers (grep proof). **Rollback:** keep deprecated tables as read-fallback behind flag. **Flag:** `ONE_CHANNEL_MODEL`.

### Wave 7 — UI surfacing (last, after backend invariants hold)
**Depends:** 3,4,5. **Scope:** Inbox shows `display_id`, labels, unified status, assignment, presence; respects RTL/mobile redesign already shipped. No backend changes.
**Acceptance:** UI reflects new capabilities; desktop `lg+` and mobile untouched in layout; no regression. **Rollback:** revert UI commits. **Flag:** none (UI-gated by capability).

### Wave 8 — Drop deprecated schema (separate, reversible)
**Depends:** 6 stable ≥1 wave. **Scope:** drop `provider_accounts`, `outbox_messages`, and any retired columns in a single reversible migration after grep-proven zero writers/readers.
**Acceptance:** deletion proof checklist (doc 05) satisfied for each object. **Rollback:** migration is reversible; restore from backup if needed.

---

## Dependency graph
```
0 → 1 → 2 → 4 → 6 → 8
      ↘ 3 ↗     ↑
        ↘ 5 ───┘
            ↘ 7
```
Wave 1 unblocks 2 and 3 in parallel. 4 needs 1+2. 5 needs 3+4. 6 needs 2+4. 7 is UI-last. 8 is the only destructive wave and is isolated.

## What is explicitly NOT a wave (avoid scope creep)
- No CSAT, portals/help-center, campaigns, web-widget, email/SMS/Telegram channels.
- No Redis/Sidekiq/Kafka unless a wave's load test proves `LISTEN/NOTIFY` insufficient.
- No AI runtime/tool redesign; no second inbox/user/tenant system; no big-bang.
