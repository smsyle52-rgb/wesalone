# 10 — Risk Register

Rank: **Critical · High · Medium · Low**. Each risk: description, trigger, mitigation, owner-action.

| ID | Rank | Risk | Trigger | Mitigation |
|---|---|---|---|---|
| R1 | **Critical** | **Cross-tenant data leak** introduced by new columns/queries (labels, display_id, channel consolidation, dispatcher). | Any new query missing `workspace_id` filter. | Standing tenant-isolation suite (doc 09) run every wave; code review rule "every new query is workspace-scoped"; RLS as optional deep-defense (handoff D2 recommendation). |
| R2 | **Critical** | **Break the live message loop** (inbound→reply) during ingestion/lifecycle/outbox refactors. | Wave 2/3/4 flips. | Shadow mode + feature flags (`INGEST_DEFERRED`, `UNIFIED_LIFECYCLE`, `EVENT_DISPATCHER`); mandatory live smoke (real inbound→reply) before/after each deploy; instant flag-off rollback. |
| R3 | **Critical** | **Duplicate customer messages** from running new + old outbox/dispatch in parallel. | Wave 2/4 dual-path. | `FOR UPDATE SKIP LOCKED` + unique idempotency keys (`outbox_events`, `webhook_events`); dual-path is read/shadow only until cutover; duplicate-event tests. |
| R4 | **High** | **Schema drift outage** (PD-12 class): a new `drizzle/00NN` not merged into `migrate-phase345.sql` → column missing in prod → silent ingestion failure. | Forgetting the merge step. | Mandatory merge into `migrate-phase345.sql` (idempotent); extend `verify-migration` to assert **columns**; CI check that every `drizzle/*.sql` has a counterpart in the merged file. |
| R5 | **High** | **`.dockerignore` source-collision** (PD-13 class): new code dir whose name matches an ignore pattern (`uploads`, `secrets`, `dist`) silently dropped from Cloud Build. | New module dir named like an ignore rule. | Add explicit `!` un-ignore for new source dirs; build-time check that expected modules exist in image; documented in SKILL. |
| R6 | **High** | **Meta permission/webhook breakage** — IG/Messenger payload shape change or relying on absent scopes (`catalog_management`/`ads_management`). | Provider change or building on missing scope. | Contract tests for both payload shapes; never build on unverified scopes (handoff governing rule); structure-only diagnostics already present in `meta.routes.ts`. |
| R7 | **High** | **Realtime regression / event loss** when lifting `max-instances` before pub/sub is solid. | Wave 4 scale-up. | Keep `max-instances=1` until `LISTEN/NOTIFY` load-tested with 2 instances; client poll fallback retained; durable log allows replay. |
| R8 | **Medium** | **Lifecycle migration corrupts in-flight conversations** (status/agent_status vs new fields disagree). | Wave 3 backfill/flip. | Projections written by one module; backfill idempotent; flag-gated reads; PD-11 reproduction test must pass. |
| R9 | **Medium** | **Automations race the agent-runner** for the same `domain_events` rows (the documented contention). | Wiring `automation-engine.ts` naively. | Single dispatcher fans events to subscribers; automation never polls `domain_events` directly; loop guards + tests. |
| R10 | **Medium** | **display_id / sequence race** produces duplicate numbers (same class as the ORD-number race in handoff). | Non-atomic max+1. | Atomic `workspace_sequences`/Postgres sequence + UNIQUE constraint + retry; never compute in app code. |
| R11 | **Medium** | **Deleting "dead" code that is actually live** (e.g. a handler reachable indirectly). | Wave 2/5/8 deletions. | Deletion proof checklist (doc 05); deprecate-before-drop; retain tables ≥1 wave; grep-proof recorded in the task. |
| R12 | **Medium** | **Concurrent edits from Cursor on `main`** land unreviewed escalation/safety logic between waves. | Parallel non-Claude commits. | Check `git log` for unreviewed Cursor commits before each wave (handoff governing note); re-audit if repo diverges from the wave's base SHA. |
| R13 | **Medium** | **Performance regression** from durable ingestion (extra writes) or dispatcher fan-out. | Wave 2/4 under load. | Load test before cutover; `webhook_events` indexed; batch claims; monitor heartbeat + latency. |
| R14 | **Low** | **Fork/maintenance drift** — diverging from Chatwoot reference makes future pattern-pulls harder. | Over-imitating Chatwoot terminology. | Adapt patterns, not names; document the mapping (these docs); pin the reference SHA. |
| R15 | **Low** | **Licensing** — accidentally copying Chatwoot Enterprise code. | Reading `enterprise/` for port. | Hard rule: no copy/derive from `enterprise/`, Captain, or `include_mod_with` Enterprise modules; open-core MIT patterns only, re-expressed in TS. |
| R16 | **Low** | **Runtime has no node_modules / native deps** — adding SDKs (sharp, heavy clients) breaks the esbuild bundle. | New dependency in api-server/worker. | Use GCP REST + metadata token pattern (existing `ai-provider.ts`/`storage.ts`); no native deps; no lockfile churn. |
| R17 | **Low** | **Right-to-erasure gap** (PDPL) remains if Wave 6 slips. | Public launch before erasure path. | Documented manual erasure process interim (handoff D7); prioritize erasure in Wave 6 before general launch. |

## Areas where Chatwoot's design should NOT be copied (risk-driven)
- **12 polymorphic `Channel::*` tables** — overkill for 3 Meta channels; use one discriminated `channel_accounts`. (R14)
- **Mandatory Redis/Sidekiq/ActionCable** — adopt the *pattern* on existing Postgres/worker first. (R13)
- **Enterprise features** (custom-role policies, SLA enforcement engine, Captain, audit mixins). (R15)
- **Rails callbacks / Wisper mechanics** — translate intent to an explicit dispatcher; don't emulate implicit callback chains. (R8/R9)
- **CSAT/portals/campaigns/web-widget/other channels** — out of product scope. (scope creep)
