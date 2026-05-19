# Go Live Checklist

## Pre-deploy verification

- Date: 2026-05-17
- git clean: no
  - Pre-existing untracked files not committed by this task:
    - `DEMO_ALNADA_WALKTHROUGH.md`
    - `docs/audit/LAST_TASK_PHASE1_CLOSURE_REPORT.md`
    - `docs/audit/PROJECT_INVENTORY.md`
  - This generated checklist is also untracked until intentionally committed.
- `cloudbuild.yaml` valid: yes
  - Parsed with the local `yaml` package from `node_modules/.pnpm/yaml@2.8.2`.
- `cloudbuild.worker.yaml` valid: yes
  - Parsed with the local `yaml` package from `node_modules/.pnpm/yaml@2.8.2`.
- Dockerfile builds: skipped
  - Local `docker` command is not available on this machine.
- Dockerfile.worker builds: skipped
  - Local `docker` command is not available on this machine.
- `.env.example` complete: no
  - Missing keys read by code:
    - `GCLOUD_PROJECT`
    - `GCP_LOCATION`
    - `GCP_PROJECT_ID`
    - `GOOGLE_CLOUD_LOCATION`
    - `GOOGLE_CLOUD_PROJECT`
    - `META_ACCESS_TOKEN`
    - `META_ACCESS_TOKEN_SECRET_REF`
    - `META_DRY_RUN`
    - `META_GRAPH_VERSION`
    - `META_REDIRECT_URI`
    - `npm_package_version` (runtime-managed by package scripts, not normally operator-provided)
- Production guards present:
  - `lib/db/package.json`: `push` and `push-force` refuse when `NODE_ENV=production` with `db:push is forbidden in production. Use migrations.`
  - `artifacts/api-server/src/modules/integrations/webhooks.routes.ts`: Meta/WhatsApp webhook HMAC verification uses `META_APP_SECRET`, `x-hub-signature-256`, SHA-256 HMAC, and timing-safe comparison.
  - `artifacts/api-server/src/app.ts`: CORS reads `ALLOWED_ORIGINS`, rejects `*`, rejects empty allow-lists for browser origins, and keeps `credentials: true`.

## Migrations awaiting first apply

Count: 10

1. `0000_faithful_vance_astro.sql`
2. `0001_common_serpent_society.sql`
3. `0002_wandering_microchip.sql`
4. `0003_critical_indexes.sql`
5. `0004_phase2_modules.sql`
6. `0005_broadcast_outbox_idempotency.sql`
7. `0006_agent_settings.sql`
8. `0007_domain_events.sql`
9. `0008_inbox_depth.sql`
10. `0009_settings_depth.sql`

## Manual steps the operator must perform (NOT for Codex)

1. Create Cloud SQL Postgres instance, take `DATABASE_URL`.
2. Create Cloud Run service `khadamatak-api`, set env vars from `.env.example`, set `SESSION_SECRET` to 64-char random, set `ALLOWED_ORIGINS` to final domain.
3. Create Cloud Run service `khadamatak-outbox-worker` with min-instances=1.
4. Apply migrations: `corepack pnpm --filter @workspace/db drizzle:migrate` against Cloud SQL.
5. Seed permissions/roles/plans: `corepack pnpm --filter @workspace/db seed`.
6. Create Meta App in developers.facebook.com, get APP_ID + APP_SECRET, add to Cloud Run env.
7. Configure Meta webhook URL: `https://<api-domain>/api/webhooks/meta` with `VERIFY_TOKEN` from env.
8. Map custom domain in Cloud Run.
9. Smoke-test: `POST /api/auth/register`, login, view dashboard.

## Notes before push/deploy

- Do not deploy until `.env.example` is updated or the missing env keys are intentionally documented as aliases/runtime-managed.
- Docker build verification still needs to run on a machine with Docker or in Cloud Build.
- No operator-only step above was executed by Codex.
