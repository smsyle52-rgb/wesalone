# 04 — Target Architecture

> The final state for Wesal One after the transformation. Built on the **inspected** code, not generic advice. Wesal keeps its stack (TS/Node, React, Postgres, Drizzle, Cloud Run), its Meta integrations, AI agents, orders/payments/inventory, RBAC, and Arabic/RTL experience. We translate Chatwoot's **boundaries and invariants**, not its Ruby/Vue.

## North-star principle

**One inbox model. One inbound event log. One outbox. One conversation lifecycle. One event dispatcher with many independent subscribers.** Everything else (AI tools, orders, payments) hangs off that spine unchanged.

---

## 1. Domain boundaries (target modules)

| Domain | Owns | Wesal home (target) | Notes |
|---|---|---|---|
| **Tenancy & Identity** | workspaces, users, memberships, roles, permissions, teams | `lib/db/schema/{workspaces,users,rbac}.ts`, `modules/{auth,users,workspace}` | Unchanged; single source of truth. Add `availability` to membership. |
| **Inbox/Channel** | the connected channel (WhatsApp/IG/Messenger) + provider config + secret ref + health | `modules/channels` + `schema/channels.ts` (renamed/merged) | **Consolidate `channel_accounts` + `provider_accounts` → one `channel_accounts` (canonical "inbox").** |
| **Contacts** | contact, per-channel identity, notes, timeline | `modules/contacts` + `schema/contacts.ts` | Unchanged; document contact_channel↔channel_account invariant. |
| **Conversations** | conversation lifecycle, assignment, labels, display_id | `modules/conversations` + `schema/conversations.ts` | Add unified state machine, `display_id`, labels, timing cols. |
| **Messages** | messages, message_type, content_attributes, attachments, delivery status | `schema/conversations.ts` (messages) | Add `message_type`, `content_attributes`, normalized sender. |
| **Ingestion** | webhook receipt, signature, durable raw log, normalization adapters | `modules/webhooks` + `modules/integrations/*adapter*` | Fast-ack → persist `webhook_events` → emit `domain_events`. |
| **Delivery** | outbox, provider send, attempts ledger, receipts | `outbox-worker` + `schema/outbox*.ts` | Merge `outbox_events`+`outbox_messages`; feed `provider_delivery_attempts`. |
| **Event bus** | domain_events + dispatcher + subscribers | `outbox-worker` (dispatcher) + `lib/events.ts` | One claimer dispatches to bot / automation / notify / realtime. |
| **Realtime** | SSE fan-out backed by external pub/sub | `lib/realtime.ts` (new) + `lib/events.ts` | Postgres `LISTEN/NOTIFY` first; Redis optional later. |
| **Assignment** | manual + auto-assignment policy + presence | `modules/conversations/assignment.*` (new) | Round-robin per inbox; availability filter. |
| **Automations** | rules, conditions, actions, macros | `outbox-worker` subscriber + `modules/automations` | Re-home orphaned engine behind dispatcher. |
| **AI Agent (preserved)** | agent runtime, 5 business tools, retrieval, safety | `lib/agent-reply.ts`, `lib/agent-tools.ts`, `lib/ai-*` | **Do not redesign.** Only its *trigger* (dispatcher) and *handoff* (lifecycle) are formalized. |

> Rule: **no second inbox, no second user/tenant system, no second conversation source of truth.** Consolidation removes the duplicate; it never adds a parallel.

---

## 2. Database ownership (target)

- **Canonical channel:** `channel_accounts` absorbs `provider_accounts` fields (`external_account_id/business_id/phone_id`, health, secret refs already linkable). `provider_secret_refs` stays (per-account secret pointers). `provider_accounts` is **DEPRECATED** after backfill.
- **Inbound log:** `webhook_events` becomes the live durable log (fed by `POST /meta`), linked to created entities via `inbound_event_links`. `domain_events` remains the **internal** work queue emitted *after* persistence.
- **Outbox:** single `outbox_events` (live) extended with the useful columns from `outbox_messages` (`provider_account_id/channel_account_id`, `next_attempt_at`, `failed_at`). `provider_delivery_attempts` is fed on every send. `outbox_messages` **DEPRECATED**.
- **Conversation:** add `display_id` (per-workspace sequential), `labels` (text[] or join table), `waiting_since`, `first_reply_created_at`, and a single `lifecycle_state` (see §6). `agent_status` retained as the **AI sub-state**, but transitions are driven by the unified state machine.
- **Message:** add `message_type` (enum: incoming/outgoing/activity/template), `content_attributes` (jsonb, holds `in_reply_to`, provider ids), keep `direction` (derivable) for back-compat during migration.
- Everything stays `workspace_id`-scoped. No table loses its tenant column.

---

## 3. API boundaries (target)

- **Public dashboard API** (`/api/*`, session cookie + `requirePermission`): conversations, messages, contacts, channels, assignment, labels, automations. Stable response envelope `{ data, error?, code? }`.
- **Webhook API** (`/api/webhooks/meta`, HMAC): GET verify, POST receive → **fast-ack 200** after persisting `webhook_events`; processing deferred.
- **Internal API** (`/internal/*`, `X-Internal-Secret` timingSafeEqual): `agent-reply`, `cleanup-*`. Unchanged contract.
- **Realtime** (`/api/inbox/stream`, SSE, session): event envelope versioned (see doc 07).

Contracts are **additive/versioned**; existing fields are never removed during a wave (see doc 07/08).

---

## 4. Event flow (target)

```
INGEST:  POST /meta → verify HMAC → persist webhook_events(status=received)
         → fast-ack 200
PROCESS: worker.ingestionDispatcher claims webhook_events(received) SKIP LOCKED
         → provider adapter normalizes → upsert contact/contact_channel/conversation/message
         → link inbound_event_links → emit domain_events(message.received)
         → webhook_events(status=processed)  | on error → retry/n → dead_letter_events
DISPATCH: worker.eventDispatcher claims domain_events(pending) SKIP LOCKED
         → fan to subscribers (each idempotent, each marks its own progress):
            • agentSubscriber  → /internal/agent-reply (if bot active)   [existing]
            • automationSubscriber → evaluate rules → actions
            • notifySubscriber → notifications + realtime publish
SEND:    /internal/agent-reply → outbox_events(message.send.*)
         worker.outboxSender claims outbox_events SKIP LOCKED → Meta Graph
         → provider_delivery_attempts(+1) → done | retry/backoff | permafail→escalate
RECEIPT: status webhook → update messages.delivery_status
```

Key change vs today: **ingestion is deferred and durable** (W2), and **one dispatcher fans events** instead of multiple loops polling the same `domain_events` rows (W7).

---

## 5. Assignment flow (target)

- Manual: `PATCH /:id/assign` (existing) → writes `assigned_membership_id`, emits `conversation.assigned`, writes an **activity message**.
- Auto: per-channel `auto_assignment_policy` (off | round_robin). On `conversation.created`/`unassigned`, `assignmentSubscriber` picks the next available membership in the inbox/team (filter by `availability=online`, capacity), assigns, emits event.
- Invariant: **assigning a human sets the AI sub-state out of autonomous send** (mirrors Chatwoot `reset_agent_bot_when_assignee_present`).

---

## 6. Human/AI handoff — the unified lifecycle (resolves W4/PD-11)

One conversation **lifecycle_state** (human-facing) with an orthogonal **ai_substate**:

```
lifecycle_state: new → open → pending → resolved → (reopened→open)        + snoozed
ai_substate:     ai_active | ai_paused | human_controlled | ai_blocked
```

Transition rules (single tested module owns these):
- New inbound on inbox with active bot → `open` + `ai_active`.
- Bot replies (within anti-loop limits) → stays `ai_active`; `consecutive_agent_replies` guard → `ai_paused`.
- Escalation (keyword / tool failure / 24h window / permafail) → `human_controlled` + `needs_human=true`; lifecycle `open`.
- Human assigned → `human_controlled` (bot will not auto-send).
- **Reactivate to bot** (the PD-11 fix): explicit action sets `ai_active`, clears `needs_human`, **and emits a fresh `message.received`-class event** so the dispatcher re-engages (today's bug: status flips but no new event).
- Resolve → `resolved`; reopen → `open` preserving prior `ai_substate` choice.

`status` and `agent_status` columns are retained but become **projections** of `(lifecycle_state, ai_substate)` written by this one module — no other code writes them directly.

---

## 7. Permission enforcement (target)

- Keep route-level `requirePermission(slug)` (finer than Chatwoot core).
- Add **object-level scoping** where Chatwoot policies do: an agent without `conversations:assign`/admin sees/acts only on conversations assigned to them or their team (optional, Wave 5).
- Worker/AI/system actors authenticate via `requireInternalSecret`; AI-authored messages keep `sender_id=null, sender_name=agent.name` (existing PD-7 invariant — **must not regress**).

---

## 8. Failure recovery (target)

- Ingestion: durable `webhook_events` + retry + `dead_letter_events` + replay endpoint that operates on the **live** log.
- Dispatch/Send: `SKIP LOCKED` claim, bounded retries, permafail → human escalation + CRITICAL log alert (existing).
- Realtime: missed events tolerated by client poll fallback **and** recoverable from durable log; multi-instance safe via external pub/sub.
- Correlation id stamped at ingestion and carried through `webhook_events → domain_events → outbox_events → messages` for end-to-end tracing.

---

## 9. Deployment implications

- No new mandatory infra in early waves: dispatcher + durable ingestion + unified lifecycle all run on the **existing** api-server + outbox-worker + Postgres.
- Realtime pub/sub: start with **Postgres `LISTEN/NOTIFY`** (no new service) — this also unblocks lifting `--max-instances=1`. Redis only if scale demands.
- Migrations follow the **proven** Wesal mechanism: author `lib/db/drizzle/00NN_*.sql` **and merge it (idempotent) into `scripts/migrate-phase345.sql`** so Cloud Build applies it before deploy (see doc 06; this is a known footgun — raw drizzle files are *not* auto-applied).
- Cloud Build keeps `ON_ERROR_STOP=1` + `verify-migration`; extend verify to assert new **columns**, not just tables (closes the PD-12 class of drift).
