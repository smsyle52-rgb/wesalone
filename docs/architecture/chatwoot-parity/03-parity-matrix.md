# 03 — Parity Matrix

Classification per capability:
- **EQ** Already equivalent · **PARTIAL** Partially equivalent · **MISSING** Not present · **DIFF-OK** Implemented differently but acceptable · **DUP** Obsolete/duplicated · **HIGHER** Wesal exceeds Chatwoot open core.

Evidence cites Wesal (`W:`) and Chatwoot (`C:`) paths verified in this audit.

| # | Capability | Class | Wesal evidence | Chatwoot evidence | Gap → action (doc 05/08 ref) |
|---|---|---|---|---|---|
| **Tenancy** |
| 1 | Tenant root scoping | EQ | W: every query `eq(workspaceId)`; `requireSession.ts` | C: `account_id` everywhere | None. Preserve. |
| 2 | Membership + roles | HIGHER | W: `rbac.ts` roles/permissions/membership_roles | C: `account_user.role` agent/admin only (custom roles=EE) | Keep Wesal RBAC. |
| 3 | Agent availability/presence | MISSING | — | C: `account_user.availability`, `auto_offline` | Add presence (W6) → Wave 5 |
| **Inbox / channel** |
| 4 | Channel container vs provider | PARTIAL/DUP | W: `channel_accounts` **and** `provider_accounts` (two models) | C: `inbox` + `channel/*` (clean split) | MERGE to one (W1) → Wave 1–2 |
| 5 | Per-channel credentials in secret store | EQ | W: `credentials_secret_ref`, `provider_secret_refs` | C: channel rows + encrypted config | None (consolidate location). |
| 6 | Channel activation/deactivation | PARTIAL | W: `channel_accounts.status` | C: inbox/channel enable | Surface from one model → Wave 2 |
| 7 | Connection health / error state | PARTIAL | W: `integration_health_checks`, `integration_error_events` (tables exist, not fed by live path) | C: per-channel health | Wire health from live path (W1) → Wave 6 |
| 8 | Inbox members (which agents) | MISSING | — (assignment is workspace-wide) | C: `inbox_member` | Add inbox membership (optional) → Wave 5 |
| **Contacts** |
| 9 | Contact identity | EQ | W: `contacts` (name/phone/email/custom_fields/tags) | C: `contact` | None. |
| 10 | Per-channel contact identity | DIFF-OK | W: `contact_channels` UNIQUE(ws,type,norm_id) | C: `contact_inbox` UNIQUE(inbox,source_id) | Document mapping (W9) → Wave 1 (docs only) |
| 11 | Duplicate detection / merge | PARTIAL | W: dedup on normalized id; merge UI (handoff D10) | C: contact merge service | Acceptable; keep. |
| 12 | Custom attributes | EQ | W: `contacts.custom_fields` jsonb | C: `custom_attributes` + `custom_attribute_definition` | Optionally add definitions registry → later |
| 13 | Contact timeline / notes | EQ | W: `contact_timeline`, `contact_notes` | C: `note`, reporting events | None. |
| **Conversations** |
| 14 | Conversation identity | EQ | W: `conversations.id` (uuid) | C: `id` + `uuid` | None. |
| 15 | Human-facing number (display_id) | MISSING | — | C: `display_id` UNIQUE(account_id) | Add per-workspace seq (W5) → Wave 3 |
| 16 | Status lifecycle | PARTIAL | W: `status` + separate `agent_status` (two axes, PD-11 bug) | C: single `status {open,resolved,pending,snoozed}` | Unify state machine (W4) → Wave 3 |
| 17 | Priority | EQ | W: `priority` (normal default) | C: `priority` enum | Align vocabulary (low/med/high/urgent) → Wave 3 |
| 18 | Assignment (human) | PARTIAL | W: `assigned_membership_id`, `PATCH /:id/assign` | C: `assignee_id` | Keep; add audit + auto (W6) → Wave 5 |
| 19 | Team assignment | EQ | W: `conversations.team_id`, `teams` | C: `team_id`, `team` | None. |
| 20 | Auto-assignment (round-robin/capacity) | MISSING | — | C: `AutoAssignmentHandler`, `assignment_policy` | Add policy (W6) → Wave 5 |
| 21 | Conversation participants | MISSING | — | C: `conversation_participant` | Add (optional) → Wave 5 |
| 22 | Labels on conversations | MISSING | W: contacts have `tags`; conversations none | C: `cached_label_list`, taggings | Add conversation labels (W5) → Wave 3 |
| 23 | Snooze / pending | PARTIAL | W: `snoozed_until`; `agent_paused_until` | C: `snoozed`+`snoozed_until`, `pending` | Fold into unified status (W4) → Wave 3 |
| 24 | Unread / last-seen | PARTIAL | W: single `unread_count` | C: `*_last_seen_at` per actor | Add last-seen (optional) → Wave 6 |
| 25 | SLA timing fields | PARTIAL | W: `sla_rules` table; no `waiting_since`/`first_reply_created_at` on conversation | C: timing cols + `sla_policy_id` (enforcement=EE) | Add timing cols (no EE engine) → Wave 6 |
| **Messages** |
| 26 | Direction | EQ | W: `messages.direction` | C: derived from `message_type` | None. |
| 27 | Message type classes (incoming/outgoing/activity/template) | MISSING | W: `direction` + free-text `source` | C: `message_type` enum | Add `message_type` enum (W8) → Wave 3 |
| 28 | Sender typing | PARTIAL | W: `sender_type` free text; `sender_id`→users; agent msgs senderId=null+senderName | C: polymorphic `sender` (User/Contact/AgentBot) | Normalize sender model (W8) → Wave 3 |
| 29 | Delivery status | EQ | W: `delivery_status`; provider receipts via worker | C: `status {sent,delivered,read,failed}` | Align enum + wire receipts → Wave 4 |
| 30 | External message id | EQ | W: `provider_message_id` (+dedup) | C: `source_id` | None. |
| 31 | Attachments | EQ | W: `messages.attachments` jsonb + media proxy | C: `attachment` model | None (model differs, OK). |
| 32 | Reply / quoted message | MISSING | — | C: `content_attributes.in_reply_to` | Add `content_attributes` (W8) → Wave 3 |
| 33 | Private / internal notes | EQ | W: `messages.is_private_note` | C: `message.private` | None. |
| 34 | Idempotency (inbound) | EQ | W: dedup `provider_message_id` | C: `source_id` uniqueness | None. |
| 35 | Ordering | EQ | W: `idx_msg_conv_created` | C: created_at ordering | None. |
| 36 | Retry / failed outbound | EQ | W: `outbox_events` 3-try backoff + escalate | C: Sidekiq retries | None (consolidate outbox). |
| 37 | Edits/deletions | MISSING/NA | — | C: limited support | Out of scope. |
| **Webhooks / inbound** |
| 38 | Verify route + signature | EQ | W: `meta.routes.ts` HMAC timingSafeEqual | C: webhook controllers verify | None. |
| 39 | Payload normalization per provider | PARTIAL | W: `handleMetaPayload` + `meta-webhook.handler` (IG/MSGR) | C: `*::IncomingMessageBuilder` | Consolidate adapters → Wave 2 |
| 40 | Durable raw event log | DUP/MISSING-in-live | W: `webhook_events` exists but **unused live**; live path synchronous | C: persisted + Sidekiq | Wire durable log (W2) → Wave 2 |
| 41 | Fast-ack + deferred processing | MISSING | W: synchronous then 200 | C: ack then job | Defer processing (W2) → Wave 2 |
| 42 | Duplicate-delivery protection | EQ | W: provider_message_id; `idempotency_keys` table | C: source_id | None. |
| 43 | DLQ / failed-event handling | DUP | W: `dead_letter_events` table exists, unused live | C: Sidekiq dead set | Wire DLQ (W2) → Wave 2 |
| 44 | Event replay | MISSING-in-live | W: `integrations.routes` exposes replay over ledger (unfed) | C: re-enqueue | Make replay operate on live log → Wave 6 |
| **Outbound delivery** |
| 45 | Outbox + worker | EQ/DUP | W: `outbox_events` (live) + `outbox_messages` (dormant) | C: jobs | MERGE (W1) → Wave 4 |
| 46 | Backoff / permafail | EQ | W: 3×60s·n + escalate | C: retry policy | None. |
| 47 | Delivery attempts ledger | DUP | W: `provider_delivery_attempts` table unused | C: attempts logged | Wire ledger → Wave 4 |
| 48 | Rate limits | PARTIAL | W: `webhookLimiter`, `apiLimiter` | C: per-channel throttles | Acceptable. |
| 49 | Channel-specific media handling | EQ | W: worker per-channel media send | C: per-channel | None. |
| **Teams / assignment** |
| 50 | Teams + membership | EQ | W: `teams`, `team_members` | C: `team`, `team_member` | None. |
| 51 | Manual assignment | EQ | W: `PATCH /:id/assign` | C: assignee set | None. |
| 52 | Auto-assignment | MISSING | — | C: auto_assignment service/jobs | Add (W6) → Wave 5 |
| 53 | Reassignment / on-offline | MISSING | — | C: round-robin reassign | Add (W6) → Wave 5 |
| 54 | Assignment audit history | PARTIAL | W: `audit_logs` generic | C: reporting + activity msgs | Add activity message on assign → Wave 3 |
| 55 | AI→human handoff | PARTIAL | W: `agent_status` + escalation | C: `assignee_agent_bot` + reset-on-assign | Unify (W4) → Wave 3 |
| **Permissions** |
| 56 | Role/permission matrix | HIGHER | W: 100+ slugs, `requirePermission` | C: 2 core roles | Keep Wesal. |
| 57 | Route-level authz | EQ | W: middleware per route | C: Pundit per controller | None. |
| 58 | Object-level authz (assignee/team scope) | PARTIAL | W: workspace scope only | C: policy scopes by assignee/team | Add object scoping where needed → Wave 5 |
| 59 | Worker/AI/system actor authz | EQ | W: `requireInternalSecret` timingSafeEqual | C: platform_app / agent_bot token | None. |
| **Realtime** |
| 60 | Realtime transport | PARTIAL | W: SSE in-process EventEmitter | C: ActionCable+Redis | External pub/sub (W3) → Wave 4 |
| 61 | Workspace scoping of events | EQ | W: `emitWorkspaceEvent(workspaceId)` | C: pubsub_token/account channel | None. |
| 62 | Assignment/unread notifications | PARTIAL | W: `notifications` table + SSE | C: notification listener+push | Wire to dispatcher → Wave 4 |
| 63 | Typing / presence | MISSING | — | C: presence channel | Optional → later |
| 64 | Failure recovery (missed events) | PARTIAL | W: poll fallback 5–10s | C: reconnect+replay | Improve with durable log → Wave 4 |
| **Automations** |
| 65 | Triggers/conditions/actions | PARTIAL | W: `automation-engine.ts` exists, orphaned | C: rule+listener+action_service | Re-home behind dispatcher (W7) → Wave 5 |
| 66 | Macros (manual multi-action) | MISSING | — | C: `macro` | Optional → later |
| 67 | Loop prevention | PARTIAL | W: agent anti-loop only | C: rule loop guards | Add for automations → Wave 5 |
| 68 | Automation audit | PARTIAL | W: generic audit | C: reporting events | Wave 5 |
| **Observability** |
| 69 | Structured logs + CRITICAL alerts | EQ | W: `logAlert` JSON severity | C: logs | None. |
| 70 | Audit log | EQ | W: `audit_logs` append-only guard | C: EE audit | Keep Wesal (avoid EE). |
| 71 | Webhook/delivery attempt visibility | DUP | W: tables exist, unfed | C: visible | Wire (W1) → Wave 2/4 |
| 72 | Correlation id end-to-end | MISSING | W: `X-Request-Id` at edge only | C: request/job ids | Add correlation id through events → Wave 2 |
| 73 | Heartbeat / liveness | EQ | W: `service_heartbeats` | C: sidekiq monitoring | None. |
| **Retention / deletion** |
| 74 | Soft delete | EQ | W: `archived_at` patterns | C: `discard`/destroy_async | None. |
| 75 | Workspace deletion | PARTIAL | W: `POST /workspace/deactivate` | C: account deletion job | Add hard-delete job → later |
| 76 | Right-to-erasure (PDPL/GDPR) | MISSING | W: soft-delete only (handoff D7) | C: data deletion service | Add erasure path → Wave 6 |
| 77 | Credential cleanup on disconnect | PARTIAL | W: secret refs | C: channel destroy clears creds | Wire on deactivate → Wave 6 |
| **AI / human handoff** |
| 78 | Bot attach to inbox | DIFF-OK | W: `channel_accounts.default_agent_id` | C: `agent_bot_inbox` | Keep; formalize lifecycle → Wave 3 |
| 79 | Handoff state machine | PARTIAL | W: active/paused/human + escalation | C: pending + reset-bot-on-assign | Unify (W4) → Wave 3 |
| 80 | Business tools (orders/payments/followup/media/handoff) | HIGHER | W: `agent-tools.ts` 5 tools | C: webhook AgentBot (no business tools) | **Preserve Wesal — do not redesign.** |

## Headline counts

- **HIGHER (preserve):** RBAC granularity, agent business tools, anti-loop/safety governors, SLA/quick-reply/saved-view tables already present.
- **EQ:** ~30 capabilities — tenancy, contacts, attachments, idempotency, retry, audit, heartbeat.
- **PARTIAL:** ~25 — lifecycle, assignment, realtime, ingestion durability, message typing.
- **MISSING:** ~15 — auto-assignment, conversation labels, display_id, participants, message reply/quote, presence, erasure, correlation id.
- **DUP:** the parallel channel/event/outbox ledger (W1) — the single largest consolidation.
