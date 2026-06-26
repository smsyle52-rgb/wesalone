# 07 — API & Event Contracts

> Proposed **stable** contracts. No implementation changed. Contracts are additive + versioned; existing fields are never removed mid-wave. Existing helpers `lib/api-spec` and `lib/api-zod` are the homes for these (extend, don't fork).

## Cross-cutting conventions
- **Auth:** session cookie (`requireSession`) for `/api/*`; `requirePermission(slug)` for authorization; `X-Internal-Secret` (timingSafeEqual) for `/internal/*`; HMAC `x-hub-signature-256` for `/api/webhooks/meta`.
- **Tenant scope:** always derived server-side from session (`activeWorkspaceId`) or, for webhooks, from the matched `channel_account`. **Never** from request body/params. (Preserves S1.)
- **Error format (uniform):** `{ "error": "<Arabic message>", "code": "<MACHINE_CODE>", "requiredPermission?": "<slug>" }`, HTTP status set; **never** leak stack traces (existing app.ts behavior — keep).
- **Idempotency:** mutating internal/outbox/webhook operations carry an idempotency key; replays return the original result.
- **Versioning:** event envelopes carry `v` (integer). Add fields freely; bump `v` only on breaking shape change. Consumers ignore unknown fields.
- **Correlation:** `correlation_id` (uuid) minted at ingestion, echoed through events/messages and in `X-Request-Id`.

---

## 1. Public dashboard API (selected, target-stable)

| Method · Path | Permission | Request (zod) | Response `data` | Notes |
|---|---|---|---|---|
| GET `/api/conversations` | `conversations:read` | query: `status?, lifecycle_state?, assignee?, label?, channel?, cursor?` | `{ items: ConversationSummary[], nextCursor? }` | add `lifecycle_state`,`label`,`display_id` filters (additive) |
| POST `/api/conversations` | `conversations:create` | `{ contactId, channelAccountId, subject? }` | `Conversation` | unchanged |
| GET `/api/conversations/:id` | `conversations:read` | — | `Conversation` (+`labels`,`display_id`,`lifecycle_state`,`ai_substate`) | additive fields |
| PATCH `/api/conversations/:id/status` | `conversations:resolve` | `{ status }` → maps to lifecycle | `Conversation` | routed through `lifecycle.ts` |
| PATCH `/api/conversations/:id/assign` | `conversations:assign` | `{ membershipId | null }` | `Conversation` | emits `conversation.assigned` + activity msg |
| POST `/api/conversations/:id/reactivate-agent` | `conversations:resolve` | — | `Conversation` | **PD-11 fix**: sets `ai_active`, clears needs_human, emits fresh inbound-class event |
| POST `/api/conversations/:id/labels` / DELETE | `conversations:update` | `{ label }` | `{ labels }` | W5 |
| POST `/api/conversations/:id/messages` | `conversations:reply` | `{ content, contentType?, attachments?, isPrivateNote?, inReplyTo? }` | `Message` | add `inReplyTo`→`content_attributes` |
| GET `/api/conversations/:id/messages` | `conversations:read` | `cursor?` | `{ items: Message[], nextCursor? }` | add `message_type`,`content_attributes` |

`ConversationSummary` (target): `{ id, displayId, contact:{id,name}, channelAccountId, channel, lifecycleState, aiSubstate, status, priority, assignee?, team?, labels[], lastMessage, lastMessageAt, unreadCount, needsHuman }`.

`Message` (target): `{ id, conversationId, direction, messageType, senderType, senderId?, senderName?, contentType, content, contentAttributes, attachments[], deliveryStatus, providerMessageId?, isPrivateNote, sentAt }`.

## 2. Internal API (unchanged contracts — keep stable)

| Method · Path | Auth | Request | Response |
|---|---|---|---|
| POST `/internal/agent-reply` | `X-Internal-Secret` | `{ workspaceId, conversationId, agentId, domainEventId }` | `{ success, outboxEventId?, shouldEscalate? }` |
| POST `/internal/cleanup-outbox` | `X-Internal-Secret` | — | `{ cleaned }` |
| POST `/internal/cleanup-domain-events` | `X-Internal-Secret` | — | `{ requeued }` |

> Invariant: AI-authored messages persist with `sender_id=null, sender_name=agent.name` (PD-7). Any change here is a breaking regression.

## 3. Meta webhooks (inbound)

- **GET `/api/webhooks/meta`** — verify: `hub.mode=subscribe` + `hub.verify_token==META_WEBHOOK_VERIFY_TOKEN` → echo `hub.challenge`; else 403. (Unchanged.)
- **POST `/api/webhooks/meta`** — HMAC `x-hub-signature-256` over raw body (timingSafeEqual). **Target behavior:** verify → persist `webhook_events{provider, idempotency_key, payload, correlation_id, status:received}` (dedup on `UNIQUE(provider, idempotency_key)`) → **return 200 fast** → defer processing. Today it processes inline then 200 (W2). Signature failure → 200 without processing (avoid Meta retries) — keep.
- **Idempotency key:** per-provider — WhatsApp: message `id`; IG/Messenger: `mid`. Falls back to hash(entry+timestamp) when absent.
- **Provider adapters** normalize `changes[]` (WhatsApp) vs `messaging[]` (IG/Messenger) — these shapes are contract-tested (the PD-6 regression class).

## 4. OAuth / embedded-signup callbacks
- Meta embedded signup + Facebook Login page-subscribe callbacks resolve to a `channel_account` (+ encrypted page token in `provider_secret_refs`/`credentials_secret_ref`). Contract: callback never returns tokens to the client; stores secret ref; surfaces only `{ connected: bool, channelType, displayName }`. (Matches existing `hasCredentialReference` exposure — keep.)

## 5. Domain events (internal work queue) — `domain_events`
Envelope:
```jsonc
{ "v":1, "workspaceId":"uuid", "eventType":"message.received",
  "entityType":"conversation", "entityId":"uuid",
  "payload": { "channelAccountId":"uuid", "messageId":"uuid", "correlationId":"uuid",
               "actorUserId?":"uuid", "actorMembershipId?":"uuid" } }
```
Canonical `eventType` set (extendable): `message.received`, `message.echo`, `conversation.created`, `conversation.assigned`, `conversation.resolved`, `conversation.reactivated`, `contact.tag.added`, `order.created`, `payment.confirmed`. The **dispatcher** (doc 04 §4) consumes these; subscribers must be idempotent on `(eventId, subscriber)`.

## 6. Outbox events (send) — `outbox_events`
Envelope `eventType` ∈ `message.send.whatsapp.{text,media,template}`, `message.send.instagram.{text,media}`, `message.send.messenger.{text,media}`. Payload contract (verified from worker): `{ to, channelAccountId, conversationId?, text|body?, mediaUrl?, mediaType?, caption?, templateName?, language?, components? }`. Unique on `(workspace_id, idempotency_key)`. **Keep this contract stable** — the worker depends on it.

## 7. Realtime events (SSE `/api/inbox/stream`)
Envelope (versioned): `{ v:1, type, workspaceId, entityType?, entityId?, payload?, createdAt }` (matches `WorkspaceRealtimeEvent`). Target transport: Postgres `LISTEN/NOTIFY` channel per workspace so multi-instance works (W3). Client tolerates gaps via poll fallback + durable log replay. Types mirror domain events plus UI-only (`conversation.updated`, `message.created`, `assignment.changed`, `unread.changed`).

## 8. Worker messages / job contracts
- Claims use `FOR UPDATE SKIP LOCKED`; each claimed row transitions `received→processing→processed|failed` (ingestion) or `pending→processing→done|failed` (outbox/domain). Retries are bounded; permafail → `dead_letter_events` (+ CRITICAL log alert) and, for sends, conversation escalation to human. (Formalizes existing behavior.)

## 9. Backward compatibility rules
- During a wave, both old and new fields are populated (e.g. `status` + `lifecycle_state`).
- Removing a field requires: (a) a prior wave where it was marked deprecated in this doc, (b) no consumer reads it (grep proof), (c) a version bump for event envelopes.
