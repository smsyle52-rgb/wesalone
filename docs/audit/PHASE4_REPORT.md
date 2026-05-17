# Phase 4-Operational Report

## Phase 4-Operational — Closure
- Date: 2026-05-17T23:05:59.9852474Z
- Commits:
  - `ffd37a9` — `feat(memory): agent context memory with rolling summary`
  - `7bf8e6d` — `feat(kb): real RAG retrieval — pgvector + lexical hybrid + draft-reply integration`
  - `440a811` — `feat(trust): controlled auto-send with topic whitelist, confidence gate, quotas, full audit`
  - `5570a20` — `feat(rt): SSE inbox stream + strict health probes + outbox heartbeat`
  - current closure commit — `chore(phase4): operational loop closure + e2e smoke + report`
- New tables: `agent_memory_snapshots`, `auto_reply_decisions`, `service_heartbeats`
- Modified tables (additive cols): `ai_agents` (`trust_mode`, `trust_confidence_threshold`, `trust_topics`, `trust_blocklist`, `max_auto_replies_per_conversation`, `escalate_after_failed_auto`, `daily_auto_send_quota`), `knowledge_chunks` (`embedding` if pgvector available, `tsv`, `embedding_model`, `embedded_at`)
- New endpoints:
  - `GET /api/ai/conversations/:id/memory`
  - `DELETE /api/ai/conversations/:id/memory`
  - `POST /api/knowledge/search`
  - `GET /api/ai/agents/:id/auto-decisions`
  - `GET /api/inbox/stream`
  - `GET /api/livez`
- Modified endpoints:
  - `POST /api/ai/runs/draft-reply` now uses memory, KB retrieval, trust gate, and outbox-only auto-send enqueue.
  - `POST /api/webhooks/:provider` keeps HMAC verification and now feeds Meta text inbound into conversations/domain events.
  - `GET /api/readyz` is strict: DB `SELECT 1` plus outbox-worker heartbeat freshness.
- pgvector: `FALLBACK_LEXICAL` locally; migration attempts `CREATE EXTENSION vector` and uses lexical fallback if unavailable.
- E2E smoke test: PASS (`corepack pnpm --filter @workspace/scripts smoke:phase4`)
  - Local mode: contract DRY_RUN because `DATABASE_URL` is not configured in this workstation.
  - DB-backed dry-run path exists in `scripts/smoke-test.ts` and runs when `DATABASE_URL` is provided.
  - External calls: 0.
- typecheck: PASS (`corepack pnpm -r typecheck`)
- build:prod: PASS (`corepack pnpm run build:prod`)
- lint: SKIPPED (`corepack pnpm -r lint --if-present` found no lint scripts)

## Locked Architectural Decisions (Phase 4-Operational)
- Agent memory = last 20 turns + rolling summary. Stored per `(conversation, agent)`. Rotated when token estimate > 6000.
- KB retrieval = hybrid: pgvector if available + PostgreSQL `tsvector` lexical fallback, merged and reranked. Top chunks are injected into bot context.
- Trust mode default = `suggest`. Auto-send only when all gates pass: mode is not `suggest`, message is not blocklisted, quota is available, business-hours rule allows it, confidence is at least threshold, and topic is whitelisted.
- Every auto-reply decision is logged in `auto_reply_decisions` with reason audit. No silent automation.
- Real-time inbox = SSE, not WebSocket. EventSource reconnects automatically.
- `/api/livez` is liveness. `/api/readyz` is strict readiness: DB plus outbox-worker heartbeat.
- Outbound provider calls remain gated by existing Meta DRY_RUN behavior. Phase 4 enqueues sends through outbox; it does not call Meta directly from the AI path.

## What This Phase Did NOT Build (By Design)
- Real Meta production calls during development.
- Voice channel.
- Telegram/Instagram channels.
- Web Chat widget.
- Multi-region replicas.
- 2FA backend.

## Operator Next Steps (For Owner, Not Codex)
1. Apply migrations to Cloud SQL.
2. Set `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` env vars.
3. Run KB embeddings backfill: `tsx scripts/backfill-kb-embeddings.ts`.
4. Configure Meta webhook to point at `/api/webhooks/meta` with `META_VERIFY_TOKEN`.
5. Connect first channel via Embedded Signup UI.
6. Configure one agent: bind KB, keep `trust_mode='suggest'` initially, observe for 24 hours.
7. Gradually enable trust topics one by one.

## Verification Notes
- `scripts/smoke-test.ts` performs a contract DRY_RUN when no database is configured. It validates the operational loop wiring: Meta HMAC, inbound webhook handler, domain events, agent memory, KB retrieval, trust gate, outbox-only auto-send, SSE inbox, and health probes.
- With a test `DATABASE_URL`, the same script runs the DB-backed dry-run scenario: creates isolated smoke data, simulates a Meta-shaped inbound WhatsApp message, verifies message/domain-event/memory persistence, verifies default `suggest_only`, flips the agent to `auto`, and verifies outbox enqueue for `message.send.whatsapp.text`.
