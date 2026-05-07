# خدماتك (Khadamatak) — SaaS Dashboard

## Overview

Full Arabic RTL, mobile-first, multi-tenant SaaS platform for Yemeni SMBs.
pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS v4 (RTL, Cairo font)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (import from `"zod"`, NOT `"zod/v4"`)
- **API codegen**: Orval (from OpenAPI spec)
- **Auth**: Session-based (express-session + connect-pg-simple)
- **RBAC**: 90 granular permissions, roles: owner/manager/agent/accountant/viewer

## Key Commands

```bash
# Full typecheck (libs + all packages)
pnpm run typecheck

# Typecheck libs only
pnpm run typecheck:libs

# Typecheck single package
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/web run typecheck

# Generate migration SQL from current schema (safe — read-only, no DB changes)
pnpm --filter @workspace/db run generate

# Apply pending migrations to target DB (requires DATABASE_URL pointing to target)
pnpm --filter @workspace/db run migrate

# Open Drizzle Studio (browser UI for the connected DB — dev only)
pnpm --filter @workspace/db run studio

# Push DB schema changes (DEV ONLY — never use in production)
pnpm --filter @workspace/db run push

# Regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

## Environment Variables

### Required (all environments)
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session cookie signing secret (≥32 chars in production) |
| `PORT` | HTTP server port (injected by Replit workflows) |

### Optional
| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | `development` or `production` | `development` |
| `GEMINI_API_KEY` | Gemini AI key — AI features work in mock mode without it | — |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow list | allow all |
| `STORAGE_PROVIDER` | `gcs` or `local` (future object storage) | — |
| `GCS_BUCKET` | Google Cloud Storage bucket name | — |
| `LOG_LEVEL` | pino log level | `info` |

### Secret Safety Rules
- `SESSION_SECRET` and `DATABASE_URL` are validated at startup in `lib/env.ts` — server exits with a clear error if missing
- Secrets are never logged — pino `redact` strips `req.headers.authorization`, `req.headers.cookie`, `set-cookie`
- `GEMINI_API_KEY` is never logged — only its presence is checked

## Database / Migrations (Phase 7B — complete)

### Migration Files Location
```
lib/db/drizzle/
├── 0000_faithful_vance_astro.sql   ← baseline migration (all 58 tables, additive only)
└── meta/
    ├── _journal.json               ← drizzle migration journal (version 7)
    └── 0000_snapshot.json          ← full schema snapshot at baseline
```

### Drizzle Config (`lib/db/drizzle.config.ts`)
- **schema**: `lib/db/src/schema/index.ts` — 58 tables, all exports
- **out**: `lib/db/drizzle/` — migration files output folder
- **migrations table**: `__drizzle_migrations` in `public` schema
- **dialect**: `postgresql`
- **dbCredentials**: `DATABASE_URL` env var (validated at startup)

### DB Scripts (`lib/db/package.json`)
| Script | Command | Purpose |
|--------|---------|---------|
| `generate` | `drizzle-kit generate` | Generate migration SQL from schema (safe — no DB changes) |
| `migrate` | `drizzle-kit migrate` | Apply pending migrations to target DB |
| `studio` | `drizzle-kit studio` | Browser UI for connected DB (dev only) |
| `push` | `drizzle-kit push` | **DEV ONLY** — prints warning, then pushes schema directly |
| `push-force` | `drizzle-kit push --force` | **DEV ONLY** — prints warning, then force-pushes |

### Baseline Migration Strategy
The project was built using `drizzle push` during development (no migration history). Phase 7B establishes the baseline:

1. **`0000_faithful_vance_astro.sql`** is the baseline — represents the entire current schema as a single `CREATE TABLE` migration
2. **This baseline should be applied to any empty staging/production DB** (Cloud SQL or otherwise)
3. **Never re-run `db:generate` from scratch** after production data exists — all future schema changes must be incremental migrations (`generate` → `review` → `migrate`)
4. **Keep all migration files in version control** — they are the authoritative history of schema changes

### Current Migration — What It Contains
- 58 `CREATE TABLE` statements (additive only — no destructive operations)
- 1 `CREATE UNIQUE INDEX` (`uq_cc_workspace_type_identifier` on `contact_channels`)
- 146 `ADD CONSTRAINT … FOREIGN KEY` statements (workspace cascade deletes, user FK references)
- 204 statement-breakpoints (drizzle-kit sequential execution markers)
- **ZERO** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE`, or destructive statements

### Rules
- **`db:push` is for development only** — it is destructive-capable and non-deterministic in production. Script now prints `[DEV ONLY]` warning before running.
- **Production requires `db:migrate`** with reviewed migration files — never `db:push`
- **Never run destructive migrations** without a full backup and explicit approval
- **Staging first** — always apply migrations to a staging DB before production

### Pre-Production Migration Workflow
```bash
# Step 1 — Generate (safe, no DB changes)
pnpm --filter @workspace/db run generate
# → creates new .sql file in lib/db/drizzle/

# Step 2 — Review the generated SQL
cat lib/db/drizzle/<new-migration-file>.sql
# Check for: DROP TABLE, DROP COLUMN, TRUNCATE — reject if found unexpectedly

# Step 3 — Apply to staging DB
DATABASE_URL=<staging-url> pnpm --filter @workspace/db run migrate

# Step 4 — Smoke test staging (healthz + readyz + auth + workspace isolation)

# Step 5 — Apply to production DB (after backup)
DATABASE_URL=<production-url> pnpm --filter @workspace/db run migrate
```

### Schema Debt — Status after Phase 7C

| Debt | Status | Migration File | Notes |
|------|--------|---------------|-------|
| `is_archived` text → boolean | **Migration ready** ✅ | `0001_common_serpent_society.sql` | USING clause added; reviewed safe |
| `team_id` text → uuid FK | **Migration ready** ✅ | `0001_common_serpent_society.sql` | tickets empty, conversations all NULL; safe |
| `daily_stats` / `team_daily_stats` empty | **Not started** | — | Aggregation phase — future |
| Rate limiters in-memory | **Documented** | — | Redis needed for multi-instance only |

### Schema Debt Migration (`0001_common_serpent_society.sql`)

**Data safety verified (2026-05-02):**

| Column | Table | Rows | Values found | Safe? |
|--------|-------|------|-------------|-------|
| `is_archived` | `report_definitions` | 3 | `'false'` ×2, `'true'` ×1 — no nulls, no unexpected values | ✅ SAFE |
| `team_id` | `tickets` | 0 | — (empty table) | ✅ SAFE |
| `team_id` | `conversations` | 2 | all NULL — no non-null values | ✅ SAFE |

**SQL (reviewed — no destructive operations):**
```sql
-- is_archived: text → boolean (USING clause handles 'true'→true, else→false)
ALTER TABLE "report_definitions"
  ALTER COLUMN "is_archived" SET DATA TYPE boolean USING (is_archived = 'true');
ALTER TABLE "report_definitions"
  ALTER COLUMN "is_archived" SET DEFAULT false;

-- team_id: text → uuid with FK (USING clause for explicit cast; NULLs stay NULL)
ALTER TABLE "conversations"
  ALTER COLUMN "team_id" SET DATA TYPE uuid USING (team_id::uuid);
ALTER TABLE "tickets"
  ALTER COLUMN "team_id" SET DATA TYPE uuid USING (team_id::uuid);

-- FK constraints to teams(id) — nullable, no cascade
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action;
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action;
```

**Rollback SQL:**
```sql
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DATA TYPE text USING (is_archived::text);
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DEFAULT 'false';
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_team_id_teams_id_fk";
ALTER TABLE "conversations" ALTER COLUMN "team_id" SET DATA TYPE text;
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_team_id_teams_id_fk";
ALTER TABLE "tickets" ALTER COLUMN "team_id" SET DATA TYPE text;
```

**To apply on staging:**
```bash
# 1 — Backup staging DB first
# 2 — Apply baseline (if fresh DB)
DATABASE_URL=<staging-url> pnpm --filter @workspace/db run migrate
# 3 — Verify
curl <staging-url>/api/readyz   # → {"status":"ready","db":"ok"}
# 4 — Spot check
psql <staging-url> -c "SELECT is_archived FROM report_definitions LIMIT 5;"
# → should return boolean t/f not text 'true'/'false'
```

**NOT applied yet** — migration file is ready and reviewed. Apply to staging only after explicit approval.

**Remaining non-debt items:**
- `daily_stats` / `team_daily_stats` empty — aggregation phase (future)
- Rate limiters in-memory — needs Redis only for multi-instance deployments

### Migration Safety Checklist
Before running `db:migrate` against any non-local DB:
- [ ] **Backup** — full DB backup completed (Cloud SQL: enable PITR or manual export)
- [ ] **Typecheck** — `pnpm run typecheck` exits 0
- [ ] **Review SQL** — no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` without explicit approval
- [ ] **Staging first** — migration applied and tested on staging DB successfully
- [ ] **Health verified** — `GET /api/healthz` → 200 and `GET /api/readyz` → 200 after migrate
- [ ] **Auth smoke test** — POST /api/auth/login works, session valid
- [ ] **Workspace isolation test** — WS1 data not visible to WS2 session
- [ ] **Payments smoke test** — payments list and confirm/reject endpoints return expected data
- [ ] **No data loss** — row counts match pre/post migration on critical tables
- [ ] **Rollback plan** — Cloud SQL PITR timestamp noted before migration starts

## Production Hardening (Phase 7A — complete)

### Security
- `X-Content-Type-Options: nosniff` — via `securityHeaders` middleware
- `X-Frame-Options: DENY` — via `securityHeaders` middleware
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Request-Id` on every response — correlates logs to requests
- Session: `httpOnly`, `secure` in production, `sameSite: lax`, 24h maxAge

### Rate Limits
| Endpoint group | Limit | Window |
|---|---|---|
| POST /auth/login, /auth/register | 10 requests | 15 minutes per IP |
| POST /ai/runs/* (5 endpoints) | 30 requests | 1 minute per IP |
| POST /payments/:id/confirm, /reject | 20 requests | 1 minute per IP |
| POST /reports/generate | 10 requests | 1 minute per IP |

Rate limit response: `{ error: "عدد المحاولات كبير، حاول لاحقاً", code: "RATE_LIMIT" }` (HTTP 429)

### Health Endpoints (public)
- `GET /api/healthz` → `{ status: "ok" }` — liveness (server running)
- `GET /api/readyz` → `{ status: "ready", db: "ok" }` or HTTP 503 — readiness (DB reachable)

### Error Codes
| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Validation / missing field |
| 401 | `UNAUTHORIZED` | No session |
| 403 | `FORBIDDEN` | Missing permission |
| 404 | `NOT_FOUND` | Resource or route not found |
| 409 | `CONFLICT` | Duplicate / state conflict |
| 422 | `BUSINESS_VIOLATION` | Business rule violation |
| 429 | `RATE_LIMIT` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected error (no stack exposed) |

### CORS
- Dev: allows all origins (ALLOWED_ORIGINS empty)
- Production: set `ALLOWED_ORIGINS=yourdomain.com,app.yourdomain.com`
- Always `credentials: true`

## Google Cloud Readiness Notes

For future production deployment on Google Cloud:

### Cloud Run
- App already binds to `PORT` env var — compatible with Cloud Run
- `trust proxy: 1` already set — handles Cloud Run load balancer headers correctly
- `NODE_ENV=production` enables secure cookies and structured JSON logging
- No hard-coded ports anywhere — all via `PORT` env var

### Cloud SQL (PostgreSQL)
**Connection string formats:**
```
# Unix socket (recommended for Cloud Run → Cloud SQL same project)
DATABASE_URL=postgresql://user:password@/dbname?host=/cloudsql/project:region:instance

# Private IP (VPC peering)
DATABASE_URL=postgresql://user:password@10.x.x.x:5432/dbname

# SSL required for public IP
DATABASE_URL=postgresql://user:password@PUBLIC_IP:5432/dbname?sslmode=require
```

**SSL:** Enable `sslmode=require` if connecting over public IP. Cloud SQL socket connections are encrypted at the OS layer — SSL parameter not needed for socket connections.

**Migration workflow for Cloud SQL:**
```bash
# 1 — Backup first (enable PITR or export via Cloud Console)

# 2 — Apply baseline migration to new Cloud SQL instance
DATABASE_URL=<cloud-sql-url> pnpm --filter @workspace/db run migrate

# 3 — Verify
curl https://your-app.run.app/api/readyz
# → {"status":"ready","db":"ok"}

# 4 — Never run db:push against Cloud SQL
```

**Never** use `db:push` on Cloud SQL. Always use `db:migrate` with reviewed migration files.

**PITR:** Enable Point-in-Time Recovery on the Cloud SQL instance before first production migration.

### Secret Manager
- Move `SESSION_SECRET`, `DATABASE_URL`, `GEMINI_API_KEY` to Google Secret Manager
- Mount secrets as env vars in Cloud Run service definition
- Never store secrets in source code or Docker images
- `lib/env.ts` validates all required secrets at startup — server exits if missing

### Cloud Storage (GCS)
- Set `STORAGE_PROVIDER=gcs` and `GCS_BUCKET=your-bucket-name`
- Use Workload Identity Federation (not service account keys) for GCS auth

### Pre-Production Checklist
**Infrastructure:**
- [ ] Cloud SQL PostgreSQL instance created with PITR enabled
- [ ] Secret Manager: SESSION_SECRET (≥32 chars random), DATABASE_URL, GEMINI_API_KEY stored
- [ ] Cloud Run service configured with secrets mounted as env vars
- [ ] `ALLOWED_ORIGINS` set to production domain(s) only
- [ ] `NODE_ENV=production` set in Cloud Run service

**Schema / Migrations:**
- [ ] Migration files reviewed — `lib/db/drizzle/0000_faithful_vance_astro.sql` contains no destructive SQL ✅
- [ ] Baseline migration applied to empty staging Cloud SQL DB
- [ ] Staging smoke tests passed: healthz, readyz, auth, workspace isolation, payments
- [ ] Full backup / PITR timestamp noted before production migration
- [ ] Baseline migration applied to production Cloud SQL DB
- [ ] `GET /api/readyz` → `{"status":"ready","db":"ok"}` on production

**Schema Debt (pre-production — explicit approval needed before fixing):**
- [ ] Fix `report_definitions.is_archived` text → boolean (requires ALTER COLUMN migration)
- [ ] Fix `tickets.team_id` text → uuid FK (requires data migration + ALTER COLUMN)

**Monitoring:**
- [ ] Cloud Monitoring alert on `GET /api/readyz` → non-200
- [ ] Uptime check on `GET /api/healthz`
- [ ] Log-based alert on `INTERNAL_ERROR` code in structured logs

## Phases Completed

### Phase 7C — Schema Debt Review & Safe Migration Plan (complete)
- **Data inspection**: verified is_archived has only 'true'/'false' (3 rows, 0 nulls); tickets.team_id empty (0 rows); conversations.team_id all NULL (2 rows) — all migrations safe
- **Schema updated**: `reports.ts` — `isArchived` text → boolean; `tickets.ts` + `conversations.ts` — `teamId` text → uuid with FK to `teamsTable`
- **Route updated**: `reports.routes.ts` — `isArchived` comparisons changed from string (`"false"`, `"true"`) to boolean (`false`, `true`)
- **Migration generated**: `lib/db/drizzle/0001_common_serpent_society.sql` — 6 ALTER statements, zero destructive operations
- **USING clause manually added** to migration SQL (drizzle-kit omits USING; required for safe text→boolean conversion with existing data)
- **Rollback SQL documented** in both migration file header and replit.md
- **Schema debt table** fully updated — both debts now show "Migration ready ✅"
- Migration **NOT applied** to any DB — awaiting explicit approval for staging
- TypeScript: EXIT:0 all packages

### Phase 7B — Migration / Cloud SQL Readiness (complete)
- `lib/db/drizzle.config.ts`: added `out` directory (`lib/db/drizzle/`), `migrations` table config (`__drizzle_migrations`), `verbose: false`, `strict: false`
- `lib/db/package.json`: added `generate`, `migrate`, `studio` scripts; `push` and `push-force` now print `[DEV ONLY]` warning before executing
- Generated baseline migration: `lib/db/drizzle/0000_faithful_vance_astro.sql` — 58 tables, 982 lines, zero destructive operations
- Migration meta: `lib/db/drizzle/meta/_journal.json` + `0000_snapshot.json` — drizzle journal version 7
- `replit.md`: full migration workflow, Cloud SQL readiness, SSL connection strings, baseline strategy, schema debt table, migration safety checklist, pre-production checklist (expanded)
- TypeScript: EXIT:0 all packages after changes

### Phase 7A — Production Hardening (complete)
- Centralized env validation: `lib/env.ts` — fails fast at startup if DATABASE_URL, SESSION_SECRET, or PORT missing
- Security headers middleware: `securityHeaders.ts` — X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Request ID header: every response includes `X-Request-Id` (correlates to pino-http request ID in logs)
- Readiness endpoint: `GET /api/readyz` — checks DB with `SELECT 1`, returns 503 if unreachable
- Rate limiting: express-rate-limit on auth (login/register), AI runs (5 endpoints), payment confirm/reject, report generate
- Error handling: improved global handler logs requestId; added `businessViolation` (HTTP 422) to errors.ts
- Frontend: `ErrorBoundary` component wraps entire app — prevents white crash screens; Arabic 404 page wired in router
- Logging: pino already redacts authorization/cookie/set-cookie headers; requestId now logged in unhandled error handler
- RBAC audit: all routes behind requireSession/requirePermission; only /healthz and /readyz are public
- Workspace isolation audit: no req.body.workspaceId or req.query.workspaceId usage found anywhere
- Secrets scan: no hardcoded secrets found; all secrets via process.env
- TypeScript: EXIT:0 for all packages

### Phase 6A — Reports/Analytics Foundation (complete)
- DB: 5 new tables in `lib/db/src/schema/reports.ts`: `metrics_events`, `daily_stats`, `team_daily_stats`, `report_definitions`, `generated_reports`. Pushed to DB.
- Seed: 7 new permissions (analytics:read, reports:read/create/update/delete/generate/export); agent gets analytics:read+reports:read; accountant gets reports:read/create/generate/export; viewer gets analytics:read+reports:read; owner/manager = all.
- AuditAction: added `report_definition_create/update/delete`, `report_generate`.
- Backend `analytics.routes.ts` (NEW): 7 analytics endpoints — GET /overview (with _meta scopeNote), /operations, /sales, /finance, /ai, /team, /channels. Date range filter (date_from, date_to). All require analytics:read.
- Backend `reports.routes.ts` (NEW): full CRUD for report definitions + generate + list/view generated reports.
- Routes: registered at /api/analytics and /api/reports in routes/index.ts.
- Frontend `AnalyticsPage.tsx` (NEW): 7-tab analytics view, date range picker, Arabic note in overview tab.
- Frontend `ReportsPage.tsx` (NEW): definitions tab + generated tab with modals.
- App.tsx + Layout.tsx: added /analytics and /reports nav items and routes.
- RBAC: 90 total permissions.

### Phase 6A.1 — Analytics Clarity + Workspace Isolation Verification (complete)
- /api/analytics/overview response now includes `_meta.scopeNote = "current_and_today_snapshot"`, `_meta.usesDateRange = false`
- AnalyticsPage overview tab: Arabic warning note about current-state vs date-range metrics
- lib/db/src/schema/reports.ts: TODO comment for is_archived text→boolean migration
- Real WS2 workspace created and tested: all 8 isolation scenarios passed (WS2 sees only WS2 data, WS1 report IDs return 404 for WS2, workspace_id injection ignored)
- TypeScript: EXIT:0 for all packages

### Phase 5A — Knowledge Base Foundation (complete)
- DB: 6 new tables; backend knowledge.routes.ts (NEW); seed 8 new permissions; frontend KnowledgePage.tsx (NEW)

### Phase 5B — Gemini AI Agents Safe Layer (complete)
- DB: 12 new AI tables; backend ai.routes.ts (18 endpoints); approvals.routes.ts; seed 9 new permissions; frontend AgentsPage.tsx (NEW)

### Phase 4B — Debts & Collection System (complete)
- DB: debts + collection_notes; backend debts.routes.ts; seed 10 new permissions; frontend DebtsPage.tsx (NEW)

### Phase 4A — Payments Stabilization (complete)
- Payments full rewrite; payment-methods.routes.ts; exchange-rates.routes.ts; frontend OrdersPage/PaymentsPage rewrite

### Phase 3B — Orders/Requests Core (complete)
- orders state machine; order_items; frontend OrdersPage full rewrite

## Artifacts

| Artifact | Path | Port |
|---|---|---|
| `artifacts/web` | `/` | 22333 |
| `artifacts/api-server` | `/api` | 8080 |
| `artifacts/mockup-sandbox` | `/__mockup` | 8081 |

## Features Implemented

### Backend (artifacts/api-server)
- Auth: register, login, logout, /me — session-based + rate limited
- Workspace management
- Users + invite (generates temporary password)
- RBAC: 90 permissions, roles (see RBAC section below)
- Audit logs — all protected with requireSession + requirePermission("audit_logs:read")
- Contacts, Conversations + Messages, Tickets, Tasks, Followups, Opportunities — all routes guarded
- Orders — state machine (new→confirmed→processing→ready→delivered→returned/cancelled)
- Payments — confirm/reject each guarded + rate limited
- Dashboard summary + activity feed
- Knowledge base: bases/sources/documents/faqs/chunks, keyword search
- AI agents: 18 endpoints, Gemini + mock, safety layer, approvals — run endpoints rate limited
- Analytics: 7 endpoints with date range filtering
- Reports: definition CRUD + generate (rate limited) + view generated reports

### Frontend (artifacts/web)
- Full Arabic RTL with Cairo font
- ErrorBoundary wraps entire app — no white crash screens
- Arabic 404 page (`/any-unknown-route` → not-found.tsx)
- Auth: Login + Register pages — rate limited
- ProtectedRoute: redirects to /login if no session; session expiry redirects to /login automatically
- Dashboard, Inbox, Tickets, Tasks, Followups, Contacts, Opportunities, Orders, Payments, Debts, Knowledge, AI Agents, Analytics, Reports, Settings, Audit Logs

## RBAC System

### Permissions (90)
All permission slugs have Arabic labels in `requirePermission.ts`.

### Roles
- **owner**: all permissions
- **manager**: all except billing:manage, users:manage_roles, integrations:manage
- **agent**: contacts CRUD, conversations, tickets, tasks, followups, opportunities, orders, payments, knowledge:read, ai:use, analytics:read, settings:read, team:read, reports:read
- **accountant**: contacts:read, payments (all), orders:read, debts, analytics, reports (read/create/generate/export), audit_logs:read, settings:read
- **viewer**: contacts:read, tickets:read, tasks:read, followups:read, opportunities:read, orders:read, payments:read, conversations:read, knowledge:read, analytics:read, settings:read, team:read, reports:read

### Enforcement
- Backend: `requirePermission(slug)` on every operational route — returns 403 JSON with Arabic error
- Frontend: `hasPermission(slug)` from AuthContext — hides/disables create buttons
- Public routes (no auth required): GET /api/healthz, GET /api/readyz, POST /api/auth/register, POST /api/auth/login

## Database Schema

All tables namespaced under workspaceId for multi-tenancy:
- workspaces, users, roles, permissions, role_permissions, workspace_memberships, membership_roles
- contacts, conversations, messages
- tickets, tasks, followups, opportunities
- orders, order_items
- payments, exchange_rates, payment_methods, debts, collection_notes
- audit_logs, outbox_messages, session
- knowledge_bases, knowledge_sources, knowledge_documents, knowledge_chunks, faq_entries, embeddings_index_reference
- ai_agents, ai_agent_versions, ai_agent_tools, ai_run_logs, ai_run_messages, ai_approval_requests, ai_feedback, ai_usage_stats, ai_safety_events, ai_prompt_templates, ai_context_injections, ai_workspace_settings
- metrics_events, daily_stats, team_daily_stats, report_definitions, generated_reports

## Important Notes

- Express 5: `req.params.id` is `string | string[]` — always cast `as string` in Drizzle `eq()` calls
- Money amounts stored as Drizzle `numeric` → `String()` on insert, `Number()` on read
- Seed runs idempotently on server startup — new permissions/role_permissions auto-created
- Existing user sessions load permissions at login time — re-login needed after role changes
- `lib/api-zod/src/index.ts` only exports `./generated/api` (Orval `mode: "single"`)
- Do NOT add `export * from "./generated/types"` — codegen no longer regenerates types dir
- `tickets.team_id` → `uuid` FK to `teams(id)` ✓ (migration 0001 applied)
- `conversations.team_id` → `uuid` FK to `teams(id)` ✓ (migration 0001 applied)
- `report_definitions.is_archived` → `boolean` DEFAULT false ✓ (migration 0001 applied)
- Drizzle migration baseline: `__drizzle_migrations` table tracks 0000 (baseline) + 0001 (schema debt)
- Phase 8A: Layout.tsx nested `<a>` inside `<Link>` fixed (hydration warning resolved)
- Phase 8A.1: SettingsPage workspace tab — edit form added (name only, canManage gate, audit log, RBAC tested)
- Phase 8A.2: POST /api/auth/change-password — self-service password change (requireSession, bcrypt verify+hash, Arabic errors, 5/15min rate limit, audit action=user_password_change, no secrets in audit/response, session preserved post-change)
- No forgot-password / OTP / email-reset flow yet (not in scope)
- revoke-other-sessions after password change: DEFERRED to future security hardening phase

## Phase 9A — Cloud Staging Deployment Preparation

### Architecture: Dev vs Staging vs Production

| Layer | Replit Dev | Staging / Cloud Run | Notes |
|---|---|---|---|
| API | `pnpm --filter @workspace/api-server run dev` (tsx watch + esbuild) | `node --enable-source-maps ./dist/index.mjs` | Builds to `dist/` via esbuild |
| Frontend | Vite dev server (HMR) | Static files served separately (e.g. Cloud Storage + CDN, or Nginx) | Builds to `artifacts/web/dist/public/` |
| DB | Replit Neon/PG | Cloud SQL (PostgreSQL 15+) | Migration: `pnpm --filter @workspace/db run migrate` |
| Sessions | PostgreSQL session store (`connect-pg-simple`) | Same DATABASE_URL | No Redis needed |

### Required Env Variables (Staging / Production)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ Required | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `SESSION_SECRET` | ✅ Required | Min 32 chars in production (enforced by env.ts) |
| `PORT` | ✅ Required | API server HTTP port |
| `NODE_ENV` | ✅ Required | Set to `production` |
| `ALLOWED_ORIGINS` | ✅ Required | Comma-separated frontend origin(s), e.g. `https://app.khadamatak.com` |
| `GEMINI_API_KEY` | Optional | AI features fall back to mock if missing |
| `STORAGE_PROVIDER` | Optional | `gcs` for Google Cloud Storage; omit for local/mock |
| `GCS_BUCKET` | Optional | Required if `STORAGE_PROVIDER=gcs` |
| `LOG_LEVEL` | Optional | Default `info`; use `warn` in production |
| `BASE_PATH` | ✅ Required (web build only) | Set to `/` for root or `/app` for sub-path |

**Security notes:**
- SESSION_SECRET < 32 chars → app crashes at boot in production (enforced)
- CORS is non-wildcard: rejects unknown origins when ALLOWED_ORIGINS is set
- Cookies: `httpOnly: true`, `secure: true` (production), `sameSite: "lax"`
- No secrets hardcoded anywhere in source

### Build Commands

```bash
# 1. Typecheck everything
pnpm run typecheck

# 2. Build API server (esbuild → dist/index.mjs)
pnpm --filter @workspace/api-server run build

# 3. Build frontend (Vite → dist/public/)
BASE_PATH="/" pnpm --filter @workspace/web run build

# 4. Run API in production mode
NODE_ENV=production node --enable-source-maps \
  artifacts/api-server/dist/index.mjs
```

### Migration Staging Plan

```bash
# On a fresh Cloud SQL staging database:
export DATABASE_URL="postgresql://user:pass@host:5432/staging_db?sslmode=require"

# Step 1: Apply all migrations (drizzle-kit migrate)
pnpm --filter @workspace/db run migrate

# Step 2: Verify health
curl https://staging.khadamatak.com/api/healthz   # → {"status":"ok"}
curl https://staging.khadamatak.com/api/readyz    # → {"status":"ready","db":"ok"}

# Step 3: Seed (server seeds automatically on first boot — idempotent)
# Step 4: Run smoke tests
BASE_URL=https://staging.khadamatak.com bash scripts/staging-smoke-test.sh
```

### Smoke Test Script

`scripts/staging-smoke-test.sh` — 22 automated tests covering:
- `/api/healthz` + `/api/readyz`
- `register` → `login` → `auth/me` → `logout`
- All 9 core modules (contacts, conversations, tickets, tasks, followups, opportunities, orders, payments, debts)
- knowledge/bases, ai/provider-status, analytics/overview, reports/definitions
- workspace, users, audit-logs

Usage: `BASE_URL=https://staging.khadamatak.com bash scripts/staging-smoke-test.sh`

### What Remains Before Production

| Item | Status | Notes |
|---|---|---|
| Forgot password / email reset | ❌ Not implemented | Needs email provider (SendGrid/SES) |
| Email verification | ❌ Not implemented | `email_verified` column exists in schema |
| Revoke other sessions on password change | ❌ Deferred | Session store is DB-backed, feasible later |
| Rate limit persistence across restarts | ⚠️ In-memory only | Upgrade to Redis limiter for HA |
| Frontend static hosting | ⚠️ Not configured | Needs Nginx/CDN in Cloud Run or separate bucket |
| HTTPS / TLS | ⚠️ Cloud Run handles | No change needed in app code |
| Cloud SQL connection pooling | ⚠️ Review | Consider `pg.Pool` max connections for Cloud Run |
| Monitoring / alerting | ❌ Not configured | Add Cloud Monitoring or Sentry |
| Backup / PITR | ❌ Not configured | Enable on Cloud SQL instance |
| WhatsApp / SMS / Voice integration | ❌ Not in scope | Future feature phase |

## Phase 9B — Staging Deployment Execution / Deployment Runbook

### Changes Made

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/env.ts` | Added `SERVE_STATIC` optional env var (boolean, default false) |
| `artifacts/api-server/src/app.ts` | Added static frontend serving gated by `SERVE_STATIC=true` (Cloud Run single-container mode) |
| `DEPLOYMENT_STAGING.md` | New file — full staging deployment runbook |

### Production Start (Confirmed Working)

**Replit Deployment** (primary path — fully configured via `artifact.toml`):
- API: `node --enable-source-maps artifacts/api-server/dist/index.mjs` (port 8080, `/api`)
- Frontend: static CDN from `artifacts/web/dist/public/` (port 22333, `/`)
- No additional configuration needed — click Deploy in Replit UI

**Cloud Run Single-Container** (via `SERVE_STATIC=true`):
- API serves static frontend from `artifacts/web/dist/public/`
- SPA fallback: all non-`/api` routes → `index.html`
- `NODE_ENV=production SERVE_STATIC=true PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs`

### Static Serving Decision

- **Replit Deployment**: frontend served separately by Replit CDN (already configured in `artifact.toml`)
- **Cloud Run Option A** (single container): `SERVE_STATIC=true` → `express.static()` + SPA fallback
- **Cloud Run Option B** (split): API only on Cloud Run, frontend on Cloud Storage/CDN

### Typecheck Results (Phase 9B)

```
typecheck:libs      → ✅ clean
api-server          → ✅ clean (9.5s)
web                 → ✅ clean (11.3s)
mockup-sandbox      → ✅ clean (8.9s)
scripts             → ✅ clean (1.5s)
```

### Build Results (Phase 9B)

| Package | Result | Output |
|---|---|---|
| `@workspace/api-server` | ✅ 1.2s | `dist/index.mjs` 2.5MB — includes static serving patch |
| `@workspace/web` | ✅ 2.6s | `dist/public/` JS: 609KB / CSS: 117KB |

### Health / Readyz

```
GET /api/healthz  → ✅ 200  {"status":"ok"}
GET /api/readyz   → ✅ 200  {"status":"ready","db":"ok"}
```

### Smoke Test Results (Phase 9B)

```
✅ All 22 smoke tests passed
```
Script: `scripts/staging-smoke-test.sh`
- Random email per run: `staging_smoke_$(date +%s)@test.local`
- Secure password: `SmokeTest999!`
- Exit code 1 on failure
- `BASE_URL` configurable

### Migration Verification (Phase 9B)

```sql
-- __drizzle_migrations: 2 rows confirmed
hash: b480c459... → created_at: 1777751654365  (0000 baseline)
hash: a61cf530... → created_at: 1777752154102  (0001 schema debt)
```
- 32+ tables confirmed in public schema
- Migration command: `pnpm --filter @workspace/db run migrate`
- Never use `db:push` in staging/production

### Security Scan (Phase 9B)

| Check | Result |
|---|---|
| `postgresql://` hardcoded in source | ✅ None — all via `process.env` |
| `SESSION_SECRET` hardcoded | ✅ None — only referenced in `env.ts` (requireEnv/validation) |
| CORS wildcard `*` | ✅ None — non-wildcard, `ALLOWED_ORIGINS` controlled |
| Cookies: `secure` in production | ✅ `process.env.NODE_ENV === "production"` |
| `SERVE_STATIC` patch in `dist/index.mjs` | ✅ 14 references (correctly bundled) |

### Staging Readiness

| Item | Status |
|---|---|
| Production build confirmed | ✅ |
| Health endpoints | ✅ |
| 22/22 smoke tests passing | ✅ |
| Typecheck clean | ✅ |
| Static serving for Cloud Run | ✅ `SERVE_STATIC=true` |
| Replit deployment config | ✅ `artifact.toml` fully configured |
| Migration journal verified | ✅ 2 migrations applied |
| Secrets runbook | ✅ `DEPLOYMENT_STAGING.md` |
| No hardcoded secrets | ✅ |
| Full runbook written | ✅ `DEPLOYMENT_STAGING.md` |
| Cloud SQL / domain / DNS | ⚠️ Needs external provisioning |
| Dockerfile for Cloud Run | ⚠️ Not yet created |
