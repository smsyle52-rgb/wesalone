# 06 — Database Migration Plan

> No executable migrations are generated here and **no migration was run**. This is the sequencing + safety plan.
> **Mechanism (Wesal-specific, mandatory):** new `lib/db/src/schema/*.ts` changes get a `lib/db/drizzle/00NN_*.sql` **AND** must be merged (idempotent) into `scripts/migrate-phase345.sql`, which Cloud Build applies before deploy. Raw drizzle files are **not** auto-applied — this exact gap caused the PD-12 production outage. Every wave below assumes this merge step.

## Principles
- **Additive-first, zero-downtime.** Add nullable columns / new tables; backfill; dual-read; switch; only then deprecate.
- **No destructive change in the same wave that introduces the replacement.** Drops happen ≥1 wave after writers are gone.
- **Idempotent SQL** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so re-runs are safe (matches proven 0027–0029 practice).
- **Tenant-isolation validation** after every change: new columns/tables carry `workspace_id`; new queries are `workspace_id`-scoped.
- **`verify-migration` extended to columns** so drift fails the build, not a customer.

## Tables to RETAIN unchanged
`workspaces, users, workspace_memberships, roles, permissions, role_permissions, membership_roles, teams, team_members, contacts, contact_channels, contact_notes, contact_timeline, domain_events, orders, order_items, payments, products(inventory), debts, knowledge*, ai_*, agent_memory, notifications, audit_logs, service_heartbeats, quick_replies, saved_views, sla_rules, business_hours, point_wallet, billing*`.

## Tables to MODIFY (additive columns)

| Table | New columns | Backfill | Notes |
|---|---|---|---|
| `conversations` | `display_id int`, `lifecycle_state text`, `ai_substate text`, `labels text[] default '{}'`, `waiting_since timestamptz`, `first_reply_created_at timestamptz` | `display_id` = `row_number()` per workspace by `created_at`; `lifecycle_state`/`ai_substate` projected from existing `status`/`agent_status` | Add **UNIQUE(workspace_id, display_id)** after backfill. Keep `status`/`agent_status` as projections. |
| `messages` | `message_type text`, `content_attributes jsonb default '{}'` | `message_type` from `direction`/`is_private_note` (`inbound`→incoming, `outbound`+note→activity, else outgoing) | `direction` retained. |
| `channel_accounts` | `external_account_id`, `external_business_id`, `external_phone_id`, `health_status text`, `last_health_at timestamptz` | backfill from `provider_accounts` join where present | toward one channel model |
| `outbox_events` | `provider_account_id uuid`, `channel_account_id uuid`, `failed_at timestamptz` | null ok | merge target |

## New TABLES (only if join-table form chosen)

| Table | Purpose | Keys/constraints | Tenant |
|---|---|---|---|
| `conversation_labels` (optional vs `labels text[]`) | normalized conversation↔label | PK(conversation_id,label); index(workspace_id,label) | `workspace_id` |
| `conversation_participants` (optional, Wave 5) | watchers | PK(conversation_id,membership_id) | `workspace_id` |
| `assignment_policies` (Wave 5) | per-channel auto-assign config | `channel_account_id`, `strategy`, `enabled` | `workspace_id` |
| `workspace_sequences` (for display_id) | atomic per-workspace counters | PK(workspace_id, name) | `workspace_id` |

> Recommendation: use `labels text[]` initially (simplest, matches `contacts.tags`); promote to a join table only if filtering/perf needs it.

## Constraints & indexes (new)
- `UNIQUE(workspace_id, display_id)` on conversations (after backfill).
- `idx_conv_ws_lifecycle` on `(workspace_id, lifecycle_state, last_message_at)`.
- `idx_messages_ws_type` on `(workspace_id, message_type)`.
- `webhook_events`: existing `UNIQUE(provider, idempotency_key)` already correct — rely on it for ingestion dedup.
- `outbox_events`: existing `UNIQUE(workspace_id, idempotency_key)` retained.

## display_id atomicity (critical — avoids the ORD-number race documented in handoff)
- Do **not** compute `max(display_id)+1` in app code (non-atomic; same bug class as duplicate order numbers).
- Use a `workspace_sequences` row updated with `UPDATE ... SET val=val+1 RETURNING val` inside the insert transaction, **or** a Postgres sequence per workspace, **or** `INSERT ... SELECT coalesce(max,0)+1 ... ON CONFLICT` guarded by the UNIQUE constraint with retry.

## Dual-read / dual-write windows
1. **Channel consolidation:** dual-read `channel_accounts` ∪ `provider_accounts` during backfill; writes go to `channel_accounts` only; `provider_accounts` becomes read-fallback, then deprecated.
2. **Outbox:** writers already target `outbox_events`; `outbox_messages` has no live writer → no dual-write needed, just deprecate.
3. **Ingestion:** behind `INGEST_DEFERRED` flag — old inline path and new durable path can coexist; the durable path is shadow-validated before becoming primary.

## Zero-downtime sequence (per change)
1. Ship additive columns/tables (nullable) + merge into `migrate-phase345.sql`.
2. Deploy code that **writes** new columns but still **reads** old (no behavior change).
3. Backfill in batches (idempotent script), validate counts + tenant scoping.
4. Flip reads to new columns behind a flag; monitor.
5. After ≥1 stable wave, remove old writers; in a later reversible migration, drop deprecated columns/tables.

## Rollback sequence
- Code: `git revert` the wave's commits (owner-driven).
- Schema: additive columns are safe to leave; if a flip misbehaves, turn the feature flag off (reads revert to old columns). Drops are deferred precisely so rollback never needs to recreate data.
- Backfill: re-runnable (idempotent); partial backfill is safe because reads stay on old columns until the flip.

## Tenant-isolation validation (every wave)
- Assert each new column/table has `workspace_id` and every new query filters on it.
- Add a test that, for a fixed second workspace, no new endpoint/field can read the first workspace's rows (extends the missing isolation suite, doc 09).
