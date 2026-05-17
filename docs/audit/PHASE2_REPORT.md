# Phase 2 — Closure

- Date: 2026-05-17T18:56:55.0246284Z
- Commits:
  - `ffe3fdb` `feat(db): phase2 schema for templates, broadcasts, automations + permissions`
  - `0316f35` `feat(templates): WhatsApp template module — API, UI, i18n, OpenAPI`
  - `5884999` `feat(broadcasts): bulk template campaigns — API, UI, outbox enqueue`
  - `832f861` `feat(automations): trigger/condition/action CRUD + test-run (no engine yet)`
  - `dd53b43` `feat(agents): bots & agents page upgrade — tabbed detail + playground`
  - current commit: `feat(layout): grouped Gabster-style sidebar + phase2 closure`
- New tables: `whatsapp_templates`, `template_versions`, `broadcasts`, `broadcast_recipients`, `automations`, `automation_runs`
- New indexes: 9
- New API endpoints: 28 new or expanded endpoints across templates, broadcasts, automations, and agents
- New pages: `TemplatesPage`, `TemplateEditorPage`, `BroadcastsPage`, `BroadcastEditorPage`, `BroadcastDetailPage`, `AutomationsPage`, `AutomationEditorPage`, `AgentsPage` upgraded, `AgentDetailPage`
- Sidebar groups: 6
- typecheck: PASS
- build:prod: PASS
- lint: SKIPPED

## Deferred to Phase 3

- Automations engine wiring to outbox-worker
- Live Meta template submission API call
- Web Chat widget runtime
- Voice channel
- Full i18n migration of remaining hardcoded strings on Inbox/Contacts/Dashboard/etc.
- Drag-and-drop automation builder

## Locked Architectural Decisions (Phase 2)

- Templates and broadcasts always tied to a `channel_account_id`.
- Broadcasts enqueue outbox events in transactional batches of 500 with `idempotency_key = "${broadcast_id}:${contact_id}"`.
- Automations Phase 2 = CRUD + test-run only; engine wiring deferred.
- Sidebar permission-gated: nav items hidden when user lacks `*:read` on resource.
- Agent (Bots) page polished without route rename, preserves existing `/api/ai/*` endpoints.
