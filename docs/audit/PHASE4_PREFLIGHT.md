# Phase 4 Operational — Preflight Inventory

## Scope

This inventory was prepared before implementation of Phase 4 Operational. It checks the existing Phase 1-3 surfaces so Phase 4 extends what exists instead of duplicating it.

## TODO / FIXME / DRY_RUN / Stub Markers

Scanned:

- `artifacts/api-server/src/services/meta-graph.ts`
- `artifacts/api-server/src/modules/integrations/meta-webhook.handler.ts`
- `artifacts/outbox-worker/src/**`
- `artifacts/api-server/src/modules/ai/**`
- `lib/db/src/schema/knowledge.ts`

Findings:

| File | Line | Marker | Note |
| --- | ---: | --- | --- |
| `artifacts/api-server/src/services/meta-graph.ts` | 28 | `META_DRY_RUN` | Meta calls are disabled when `META_DRY_RUN=true`. |
| `artifacts/outbox-worker/src/index.ts` | 88 | `META_DRY_RUN` | Worker returns dry-run for Meta outbound when secret/token is missing or dry-run is enabled. |
| `artifacts/outbox-worker/src/index.ts` | 89 | `DRY_RUN` | Worker logs Meta outbound dry-run. |
| `artifacts/outbox-worker/src/index.ts` | 113 | `stubbed` | Legacy WhatsApp outbox path remains stubbed when app secret is absent. |

No `TODO` or `FIXME` markers were found in the scoped files.

## Required Tables From Phases 1-3

| Table | Exists in schema | Source |
| --- | --- | --- |
| `whatsapp_templates` | yes | `lib/db/src/schema/templates.ts` |
| `broadcasts` | yes | `lib/db/src/schema/broadcasts.ts` |
| `broadcast_recipients` | yes | `lib/db/src/schema/broadcasts.ts` |
| `automations` | yes | `lib/db/src/schema/automations.ts` |
| `automation_runs` | yes | `lib/db/src/schema/automations.ts` |
| `domain_events` | yes | `lib/db/src/schema/domain_events.ts` |
| `quick_replies` | yes | `lib/db/src/schema/inbox_ops.ts` |
| `saved_views` | yes | `lib/db/src/schema/inbox_ops.ts` |
| `sla_rules` | yes | `lib/db/src/schema/inbox_ops.ts` |
| `business_hours` | yes | `lib/db/src/schema/inbox_ops.ts` |
| `knowledge_bases` | yes | `lib/db/src/schema/knowledge.ts` |
| `knowledge_documents` | yes | `lib/db/src/schema/knowledge.ts` |
| `knowledge_chunks` | yes | `lib/db/src/schema/knowledge.ts` |
| `ai_agents` | yes | `lib/db/src/schema/ai.ts` |

## Agent Table Inventory

Actual table backing `AgentsPage`: `ai_agents`.

Columns present:

- `id`
- `workspace_id`
- `name`
- `type`
- `status`
- `default_model`
- `temperature`
- `max_output_tokens`
- `knowledge_base_ids`
- `dialect`
- `tone`
- `created_by`
- `created_at`
- `updated_at`

Related agent tables:

- `ai_agent_instructions`: `role_prompt`, `business_rules`, `forbidden_actions`, `escalation_rules`
- `ai_agent_channels`: `channel_account_id`, `mode`
- `ai_runs`, `ai_messages`, `ai_feedback`, `ai_safety_events`

Specific checks:

- `system_prompt`: no exact column. Equivalent prompt lives as `ai_agent_instructions.role_prompt`.
- `model`: no exact column. Equivalent model setting lives as `ai_agents.default_model`.
- `temperature`: yes, `ai_agents.temperature`.
- `knowledge_base_id`: plural JSON relation exists as `ai_agents.knowledge_base_ids`.
- `channel_account_id`: relation exists in `ai_agent_channels.channel_account_id`.
- `status`: yes, `ai_agents.status` with current values `active` / `disabled`.
- `trust_mode`: absent and required for Phase 4C.

## Messages Table Context Columns

Actual table: `messages`.

Relevant columns:

- `content`: text message content.
- `direction`: message direction, default `outbound`.
- `conversation_id`: conversation FK.
- `sender_type`: sender category, default `user`.
- `sender_id`: user FK for user-sent messages.
- `sender_name`: display sender name.
- `source`: message source.
- `content_type`: text/image/audio/document/note category.
- `is_ai_draft`: marks AI-generated drafts.
- `is_private_note`: marks internal notes.
- `provider_message_id`: provider message id for idempotency/delivery.

## Knowledge Embedding Inventory

Current `knowledge_chunks` columns:

- `chunk_text`
- `embedding_status`
- `embedding_ref`
- `metadata`

Embedding vector column: no.

Existing vector search support: no.

Current search behavior: lexical `ILIKE` style search in AI routes and knowledge routes. Phase 4B needs additive `embedding` and `tsv` support with pgvector fallback.

## Existing `/api/ai` Endpoints

Mounted under `/api/ai`:

- `GET /provider-status`
- `GET /agents`
- `POST /agents`
- `GET /agents/:id`
- `PATCH /agents/:id`
- `POST /agents/:id/duplicate`
- `DELETE /agents/:id`
- `POST /agents/:id/versions`
- `PATCH /agents/:id/instructions`
- `GET /agents/:id/tools`
- `PATCH /agents/:id/tools`
- `GET /runs`
- `GET /runs/:id`
- `POST /runs/:id/feedback`
- `GET /usage`
- `GET /safety-events`
- `POST /runs/summarize-conversation`
- `POST /runs/knowledge-answer`
- `POST /runs/classify-conversation`
- `POST /runs/draft-reply`
- `POST /runs/extract`
- `POST /runs/suggest-actions`

## Preflight Conclusions

- Phase 4A should add `agent_memory_snapshots` and wire it into the existing `/api/ai/runs/draft-reply` path.
- Phase 4B should extend `knowledge_chunks` rather than create a parallel chunk table.
- Phase 4C should add trust columns to `ai_agents` and create `auto_reply_decisions`.
- Phase 4D should add `service_heartbeats` and extend existing health routes.
- Meta outbound is already dry-run safe; Phase 4 should not make external calls during development.
