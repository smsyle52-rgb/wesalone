# 02 — Chatwoot Reference Map

> Reference only. Source: `github.com/chatwoot/chatwoot` @ `develop` `d0b1c055e8fa40ab19e4898ed6cf1aafd24431fc` (2026-06-25), shallow-cloned read-only into the scratchpad. **Not** added to the Wesal One repository, not a submodule, not a dependency.
> Purpose: extract *verified domain behaviors, boundaries and invariants* to translate into Wesal One's TypeScript/Drizzle stack. We translate **patterns**, never Ruby/Vue code, never Enterprise code.

## License & copy boundary (must read first)

- Chatwoot open core is **MIT**, but the repo also contains **`enterprise/`** (LICENSE = Chatwoot Enterprise/Commercial) and **Captain** AI. **Do not read-for-port, copy, derive from, or depend on** anything under `enterprise/`, `app/**/captain*`, `policies/captain/`, or any `*_mod`/`include_mod_with` Enterprise mixin.
- We adapt **architecture and behavior** (state machines, job boundaries, idempotency, assignment policy semantics), expressed in our own code. No verbatim translation.
- Verified Enterprise touchpoints to avoid: `enterprise/` tree (`app`, `config`, `lib`); `AgentBot.include_mod_with('Audit::AgentBot')` and similar `include_mod_with` calls pull Enterprise modules — ignore the Enterprise side. SLA enforcement, custom roles, Captain assistant, and audit-trail mixins are wholly or partly Enterprise.

---

## Domain module map (open core)

### Accounts & tenancy
- `app/models/account.rb` — the tenant root. Everything is `account_id`-scoped.
- `app/models/account_user.rb` — user↔account membership with `role` (enum: agent/administrator) and `availability`, `auto_offline`.
- `app/models/user.rb`, `user_session.rb`.
- **Pattern to adapt:** every record is account-scoped; membership carries role **and presence/availability**. → Wesal `workspace_memberships` already exists; add availability.
- **Boundary:** custom roles beyond agent/administrator are **Enterprise** — do not import. Wesal's `roles`/`permissions` already exceeds this and is fine.

### Inbox & channels
- `app/models/inbox.rb` — channel-agnostic conversation container. `belongs_to :channel, polymorphic: true`. Holds inbox-level settings (greeting, working hours link, auto-assignment toggle, csat).
- `app/models/channel/*.rb` — one class per medium: `whatsapp.rb`, `instagram.rb`, `facebook_page.rb`, `api.rb`, `web_widget.rb`, `email.rb`, `sms.rb`, `telegram.rb`, `line.rb`, `twilio_sms.rb`, `twitter_profile.rb`, `tiktok.rb`. Each owns provider credentials + identifiers + `medium`.
- `app/models/inbox_member.rb` — which agents belong to an inbox.
- `app/models/agent_bot_inbox.rb` — which bot is attached to an inbox.
- **Pattern to adapt:** **separate the channel container (Inbox) from the channel implementation (Channel::X).** Inbox is what conversations/assignments/members attach to; Channel::X is provider plumbing. → Wesal collapses both into `channel_accounts` (+ a duplicate `provider_accounts`). Target: one logical "inbox/channel" with a `channel_type` discriminator and typed provider config (don't introduce 12 tables; a discriminated `provider_config` is acceptable for our 3 Meta channels).

### Contacts
- `app/models/contact.rb` — account-scoped person; `identifier`, `email`, `phone_number`, `additional_attributes`, `custom_attributes`.
- `app/models/contact_inbox.rb` — **the per-channel identity join**: `(contact_id, inbox_id, source_id)` with **UNIQUE(inbox_id, source_id)**, `pubsub_token`, `hmac_verified`. `source_id` = the provider-side id (phone/PSID/IGSID). `current_conversation = conversations.last`.
- **Invariant to adapt:** an inbound message is resolved to a conversation via `(inbox, source_id) → contact_inbox → conversation`. → Wesal's `contact_channels (workspace, channel_type, normalized_identifier)` is the analogue but scoped to workspace+type, not inbox. Document the mapping; do not necessarily restructure (W9 is Low).

### Conversations
- `app/models/conversation.rb` — `enum status {open:0, resolved:1, pending:2, snoozed:3}`, `enum priority {low,medium,high,urgent}`. Keys: `account_id, inbox_id, contact_id, contact_inbox_id, assignee_id (User), assignee_agent_bot_id (AgentBot), team_id, campaign_id, sla_policy_id, display_id (UNIQUE per account), uuid`. Timing: `last_activity_at, waiting_since, first_reply_created_at, *_last_seen_at`. Concerns: `AssignmentHandler, AutoAssignmentHandler, Labelable, ActivityMessageHandler, SortHandler`.
- **Invariants to adapt (high value):**
  - `before_validation :reset_agent_bot_when_assignee_present` → **assigning a human clears the bot** (single source of "who's handling this").
  - `before_create :determine_conversation_status` → status derived from inbox/bot config (e.g. starts `pending` if a bot is attached).
  - `display_id` per-account sequential = the human-facing conversation number.
  - `pending` status = bot/agent-bot is handling; `open` = needs/has human; `snoozed` + `snoozed_until`; `resolved`.
- `app/models/conversation_participant.rb` — agents watching a conversation (notifications) without being the assignee.

### Messages
- `app/models/message.rb` — `message_type {incoming, outgoing, activity, template}`, `content_type`, `content_attributes` (jsonb: holds `in_reply_to`, external ids, submitted form, etc.), `sender` (polymorphic: User/Contact/AgentBot), `status {sent,delivered,read,failed}`, `source_id` (provider id), `private` (internal note flag).
- **Patterns to adapt:** `message_type` as a first-class enum distinct from direction; `content_attributes` jsonb for reply/quote + provider metadata; polymorphic sender; `activity` messages for system events (assigned, resolved, etc.).

### Webhooks & inbound ingestion
- Controllers under `app/controllers/webhooks/*` ack fast; real work is deferred to Sidekiq jobs `app/jobs/channels/**` and services `app/services/{whatsapp,instagram,facebook,...}` (e.g. `*::IncomingMessageService`, `*::IncomingMessageBuilder`).
- `app/services/contact_inbox_source_id_resolver.rb` — normalizes provider ids to a `contact_inbox`.
- **Patterns to adapt:** **fast-ack then deferred job**; provider-specific *adapter/builder* that normalizes payloads into the shared conversation/message model; signature verification at the controller boundary.

### Outbound delivery
- `app/jobs/send_reply_job.rb`, `app/services/**/send_*` per channel; `Messages::*`. Delivery status updated from provider receipts.
- **Patterns to adapt:** one send pipeline keyed by inbox.channel medium (Wesal already does this in the worker); persist attempts; reconcile delivery receipts back onto the message `status`.

### Teams & assignment
- `app/models/team.rb`, `team_member.rb`; `app/models/assignment_policy.rb`, `inbox_assignment_policy.rb` (round-robin/balanced); concerns `AutoAssignmentHandler`; jobs `app/jobs/auto_assignment/**`; services `app/services/auto_assignment/**`.
- **Patterns to adapt:** per-inbox auto-assignment policy + capacity + availability filter; reassignment on agent going offline. (Note: advanced **assignment_policy** capacity limits trend Enterprise; the **round-robin core** is in open core.)

### Permissions / authorization
- `app/policies/*_policy.rb` (Pundit) — one policy object per resource (`conversation_policy`, `inbox_policy`, `contact_policy`, …) checked in controllers.
- **Pattern to adapt:** resource-level authorization objects. → Wesal uses per-route `requirePermission(slug)` which is equivalent and finer-grained; keep Wesal's model, optionally add object-level checks (assignee/team scoping) where Chatwoot policies do.
- **Boundary:** custom-role policies are Enterprise; ignore.

### Realtime & notifications
- `app/listeners/action_cable_listener.rb` + `app/jobs/action_cable_broadcast_job.rb` → ActionCable over **Redis**; `pubsub_token` scopes a contact/agent channel.
- `app/models/notification.rb`, `notification_setting.rb`, `notification_subscription.rb` (web push).
- **Pattern to adapt:** event → broadcast job → external pub/sub (so it survives multiple app instances). → Wesal must replace in-process EventEmitter (W3) with Postgres `LISTEN/NOTIFY` or Redis.

### Automations
- `app/models/automation_rule.rb`, `macro.rb`; `app/listeners/automation_rule_listener.rb`; `app/services/automation_rules/**`, `action_service.rb`; jobs `macros_execution_job.rb`.
- **Pattern to adapt:** event listener evaluates rules (event_name + conditions) → executes actions via a shared `ActionService`; macros = manual multi-action. Loop-prevention + audit are built into the listener path. → Wesal's orphaned `automation-engine.ts` should be re-homed behind a single dispatcher (W7).

### Event system (the backbone)
- **Wisper listeners** (`app/listeners/*`) subscribe to domain events; `app/jobs/event_dispatcher_job.rb` fans events to listeners; each listener enqueues its own job (`hook_job`, `notification`, `reporting_event`, `action_cable`).
- **Pattern to adapt:** **one event, many independent subscribers, each on its own job** — this is exactly how Wesal should resolve the agent-runner vs automation-engine contention (W7): a single dispatcher reads `domain_events` and dispatches to bot/automation/notification/realtime subscribers rather than each polling the same rows.

### Observability
- `app/models/reporting_event.rb` + `reporting_events_rollup.rb`; `reporting_event_listener.rb`. Audit trail is **Enterprise** (`Audit::*` mixins).
- **Pattern to adapt:** reporting events table fed by a listener (Wesal has `reports` + `audit_logs` already). Keep Wesal's audit (don't import Enterprise audit).

---

## Patterns worth adapting (ranked)

1. **Inbox = container, Channel = provider** separation (resolves Wesal's dual channel model).
2. **Fast-ack webhook → durable raw event → deferred job → DLQ/replay** (resolves W2).
3. **One event → many independent subscriber jobs** via a dispatcher (resolves W7 contention).
4. **Single conversation state machine** where assigning a human resets the bot (`reset_agent_bot_when_assignee_present`) and bot-handled = `pending` (resolves W4).
5. **`message_type` enum + `content_attributes` jsonb + polymorphic sender** (resolves W8).
6. **`contact_inbox.source_id` UNIQUE per inbox** as the inbound resolution key (informs W9).
7. **Per-inbox auto-assignment policy + agent availability** (resolves W6).
8. **`display_id` per-account sequential** human-facing conversation number (resolves part of W5).
9. **Realtime via external pub/sub keyed by a scoped token** (resolves W3).
10. **Activity messages** as first-class system events for the timeline.

## Patterns to NOT bring into Wesal One

- **Ruby/Rails idioms** (STI polymorphic `Channel::*` as 12 tables, ActiveRecord callbacks, Wisper) — adapt the *intent* in TS, not the mechanism. For 3 Meta channels, a discriminated single channel table beats 12 tables.
- **ActionCable/Sidekiq/Redis as mandatory infra** — adopt the *pattern* (external pub/sub, deferred jobs) using what Wesal already runs (Postgres `LISTEN/NOTIFY`, the existing worker) before adding Redis.
- **Enterprise features**: custom-role policies, SLA *enforcement* engine, Captain AI, audit mixins, advanced assignment capacity. (Wesal already has its own RBAC, SLA *tables*, and AI agents — keep Wesal's.)
- **CSAT, Portals/Help-center, Campaigns, web-widget, email/SMS/Telegram/Line channels** — out of scope; Wesal is Meta-only + AI sales agent. Do not scaffold these.
- **Second user/tenant system** — never. Wesal `workspaces`/`users` stays the single source of truth.
