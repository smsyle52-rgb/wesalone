# خدماتك CRM — Staging Deployment Runbook

## Phase 9B — Staging Deployment Execution

---

## Architecture Overview

### Replit Deployment (Primary Path)

The project is fully configured for Replit Deployments via `artifact.toml`:

| Artifact | Role | Path | Build | Serve |
|---|---|---|---|---|
| `artifacts/api-server` | API (Node.js) | `/api` | esbuild → `dist/index.mjs` | `node --enable-source-maps dist/index.mjs` |
| `artifacts/web` | Frontend (React/Vite) | `/` | Vite → `dist/public/` | Static (Replit CDN) |

**No manual Cloud Run setup needed for Replit staging.**

### Cloud Run (Alternative Path)

Two options:

**Option A — Single Container (Recommended)**
- API serves static frontend via `SERVE_STATIC=true` env var
- Single Cloud Run service handles everything
- `express.static()` serves `artifacts/web/dist/public/`
- SPA fallback: all non-API routes → `index.html`

**Option B — Split Services**
- Cloud Run for API only (port 8080, path `/api`)
- Cloud Storage + CDN for frontend static files
- Requires configuring CORS `ALLOWED_ORIGINS` with CDN domain

---

## Prerequisites

### Cloud SQL Setup

```bash
# 1. Create Cloud SQL PostgreSQL 15+ instance
gcloud sql instances create khadamatak-staging \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=me-central1 \
  --storage-size=10GB \
  --backup \
  --enable-point-in-time-recovery

# 2. Create database
gcloud sql databases create khadamatak_staging \
  --instance=khadamatak-staging

# 3. Create user (use Secret Manager for password)
gcloud sql users create khadamatak_app \
  --instance=khadamatak-staging \
  --password="$(openssl rand -base64 32)"

# 4. Get connection string
# postgresql://khadamatak_app:<PASSWORD>@<IP>:5432/khadamatak_staging?sslmode=require
```

---

## Environment Variables

### Required — API Server

```bash
DATABASE_URL="postgresql://user:pass@host:5432/khadamatak_staging?sslmode=require"
SESSION_SECRET="$(openssl rand -base64 48)"   # min 32 chars — enforced at boot
PORT="8080"
NODE_ENV="production"
ALLOWED_ORIGINS="https://staging.khadamatak.com"   # NO wildcard when credentials=true
```

### Optional

```bash
GEMINI_API_KEY="..."         # AI features; falls back to mock if missing
LOG_LEVEL="warn"             # Reduce log noise in staging
STORAGE_PROVIDER="gcs"       # Omit for local/mock storage
GCS_BUCKET="khadamatak-staging-files"
SERVE_STATIC="true"          # Only for Cloud Run single-container (Option A)
```

### Web Frontend (build-time only)

```bash
BASE_PATH="/"                # Root path for Replit or Cloud Run single-container
```

### Where to Store Secrets

| Secret | Storage |
|---|---|
| `DATABASE_URL` | Replit Secrets / GCP Secret Manager |
| `SESSION_SECRET` | Replit Secrets / GCP Secret Manager |
| `GEMINI_API_KEY` | Replit Secrets / GCP Secret Manager |
| `GCS credentials` | GCP Service Account (Workload Identity preferred) |

**Never commit secrets to git. Never log secret values.**

---

## Build Commands

```bash
# Full typecheck (must pass before build)
pnpm run typecheck

# Build API server → artifacts/api-server/dist/index.mjs
pnpm --filter @workspace/api-server run build

# Build frontend → artifacts/web/dist/public/
BASE_PATH="/" pnpm --filter @workspace/web run build
```

---

## Migration Procedure

> ⚠️ Always run migrations BEFORE starting the application.
> Never use `db:push` in staging or production — only `db:migrate`.

```bash
# Point to staging database
export DATABASE_URL="postgresql://user:pass@host:5432/khadamatak_staging?sslmode=require"

# Apply all pending migrations
pnpm --filter @workspace/db run migrate
# Expected output:
#   Applying migration 0000_... (baseline)
#   Applying migration 0001_common_serpent_society
#   Migrations applied successfully

# Verify
curl https://staging.khadamatak.com/api/readyz
# Expected: {"status":"ready","db":"ok"}
```

### Migration Files

| Migration | Contents |
|---|---|
| `0000_initial_baseline.sql` | Full schema baseline (all tables, indexes, FKs) |
| `0001_common_serpent_society.sql` | `is_archived` boolean, `team_id` uuid FK |

---

## Production Start

### Replit Deployment

Handled automatically by `artifact.toml` production blocks. Click "Deploy" in Replit UI.

### Cloud Run (Single Container — Option A)

```bash
# Build and push container
docker build -t gcr.io/PROJECT/khadamatak-api:staging .
docker push gcr.io/PROJECT/khadamatak-api:staging

# Deploy
gcloud run deploy khadamatak-staging \
  --image gcr.io/PROJECT/khadamatak-api:staging \
  --region me-central1 \
  --port 8080 \
  --set-env-vars NODE_ENV=production,SERVE_STATIC=true \
  --set-secrets DATABASE_URL=khadamatak-db-url:latest \
  --set-secrets SESSION_SECRET=khadamatak-session-secret:latest \
  --set-env-vars ALLOWED_ORIGINS=https://staging.khadamatak.com

# Or manual start (local test):
NODE_ENV=production SERVE_STATIC=true PORT=8080 \
  ALLOWED_ORIGINS=https://staging.example.com \
  SESSION_SECRET="$(openssl rand -base64 48)" \
  DATABASE_URL="..." \
  node --enable-source-maps artifacts/api-server/dist/index.mjs
```

---

## Smoke Tests

```bash
# Run all 22 smoke tests against staging
BASE_URL=https://staging.khadamatak.com bash scripts/staging-smoke-test.sh

# Or against local production build
BASE_URL=http://localhost:8080 bash scripts/staging-smoke-test.sh
```

Expected output:
```
✓ [200] /api/healthz
✓ [200] /api/readyz
✓ [201] POST /api/auth/register
...
✅ All 22 smoke tests passed
```

---

## Post-Deploy Verification Checklist

```
□ GET /api/healthz → {"status":"ok"}
□ GET /api/readyz  → {"status":"ready","db":"ok"}
□ smoke tests: 22/22 pass
□ Register new user → success
□ Login → session cookie set (httpOnly, Secure in production)
□ CORS: frontend origin allowed, others rejected
□ Audit log entries being created
□ No 500 errors in logs
□ SESSION_SECRET length ≥ 32 (app would crash otherwise)
□ No hardcoded secrets in logs (pino redacts cookie headers)
```

---

## CORS Notes

- `ALLOWED_ORIGINS` must contain the frontend origin exactly (comma-separated)
- Example: `ALLOWED_ORIGINS=https://staging.khadamatak.com`
- **Never use `*` with `credentials: true`** — browser will reject CORS preflight
- Development: `ALLOWED_ORIGINS` empty → all origins allowed (only in dev)

---

## Rollback Plan

### Replit
- Use Replit Checkpoints to rollback to previous commit
- Database rollback: restore Cloud SQL from automated backup

### Cloud Run
```bash
# Rollback to previous revision
gcloud run revisions list --service=khadamatak-staging
gcloud run services update-traffic khadamatak-staging \
  --to-revisions=PREVIOUS_REVISION=100
```

### Database
- No down migrations exist (by design — forward-only)
- Restore from Cloud SQL automated backup / PITR if schema migration causes issues
- For minor data issues: direct SQL via Cloud SQL Auth Proxy

---

## Known Limitations Before Production

| Item | Status | Action Needed |
|---|---|---|
| Forgot password / email reset | ❌ Not implemented | Integrate email provider (SendGrid/SES) |
| Email verification | ❌ Not enforced | `email_verified` column exists, flow missing |
| Rate limit persistence | ⚠️ In-memory only | Add Redis for HA / multi-instance |
| Revoke other sessions on password change | ⚠️ Deferred | Implement session invalidation |
| Bundle size | ⚠️ 609KB JS | Add code-splitting when ready |
| Monitoring / alerting | ❌ None | Add Cloud Monitoring or Sentry |
| Dockerfile | ❌ Not created | Needed for Cloud Run deployment |

---

## Security Checklist

```
✅ No secrets hardcoded in source
✅ SESSION_SECRET validated at boot (≥32 chars in production)
✅ CORS: non-wildcard, rejects unknown origins
✅ Cookies: httpOnly=true, secure=true (production), sameSite=lax
✅ Pino redacts cookie headers from logs
✅ Rate limits: auth (10/15min), change-password (5/15min), AI (30/min)
✅ X-Request-Id on every response
✅ Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy
✅ Audit log: no passwords/hashes stored
✅ readyz exposes only {"status":"ready","db":"ok"}
⚠️ Secret Manager: not yet configured (use Replit Secrets for now)
⚠️ TLS: handled by Cloud Run / Replit (no change in app code)
```
