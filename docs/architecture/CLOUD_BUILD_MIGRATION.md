# Cloud Build Database Migration

## Overview
- Every deploy pipeline now runs `scripts/migrate-phase345.sql` before Cloud Run deploy.
- If migration fails, Cloud Build stops immediately and the deploy step does not run.
- A follow-up verification query checks that required Phase 3/4/5 tables exist.

## How It Works In CI
1. Cloud Build loads `DATABASE_URL` from Secret Manager (`availableSecrets` + `secretEnv`).
2. Secret source is controlled by `_DATABASE_URL_SECRET`:
   - `DATABASE_URL` for staging
   - `DATABASE_URL_PROD` for production
3. A temporary Cloud SQL Auth Proxy starts on `127.0.0.1:5433` using `_DB_CONNECTION_NAME`.
4. The runtime-style socket URL is converted to a TCP URL for `psql`.
5. Migration step executes:
   - `psql "${_DATABASE_URL}" -f scripts/migrate-phase345.sql`
6. Verification step runs:
   - `SELECT count(*) ... IN ('domain_events','agent_memory_snapshots','auto_reply_decisions','whatsapp_templates','broadcasts','automations')`
   - expected count is `6`.

## Manual Run (Cloud Shell)
Use this only when an operator needs a controlled manual apply:

```bash
DB_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=<PROJECT_ID>)"
wget -q https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64 -O ~/cloud-sql-proxy
chmod +x ~/cloud-sql-proxy
~/cloud-sql-proxy <PROJECT:REGION:INSTANCE> --port=5433 &

DB_USER="$(echo "$DB_URL" | sed 's|.*://\([^:]*\):.*|\1|')"
DB_PASS="$(echo "$DB_URL" | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')"

PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p 5433 -U "$DB_USER" -d khadamatak_staging -f scripts/migrate-phase345.sql
```

## Adding New Migrations To The Bundle
1. Add new Drizzle SQL migration file under `lib/db/drizzle/`.
2. Copy the additive SQL into `scripts/migrate-phase345.sql` (or next bundle file) using idempotent guards:
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - `DO $$ ... EXCEPTION ... $$` for `ALTER TABLE ADD COLUMN` and extension-sensitive operations.
3. Keep verification queries updated with newly required tables.
4. Commit bundle update before running any deploy pipeline.

## Substitution Variables
- `_DB_CONNECTION_NAME`: Cloud SQL instance connection name (`project:region:instance`).
- `_DATABASE_URL_SECRET`: Secret Manager name that holds the database URL.
  - default: `DATABASE_URL`
  - production override: `DATABASE_URL_PROD`

## Idempotency Guarantee
- The migration bundle is written to be safe for re-run.
- Re-running does not drop data and does not duplicate schema objects.
- This is why running from both API and worker Cloud Build pipelines is safe.
