# Khadamatak First Production Deploy Runbook

> Operator-only guide. Do not run these steps from an automated coding session. Keep all secrets in Google Secret Manager or Cloud Run environment, never in git, chat, logs, or database rows.

## 0. Pre-flight

What to do / ماذا تعمل:
- Arabic: تأكد أن الفرع المطلوب مبني بنجاح محلياً أو في Cloud Build، وأن `docs/audit/PHASE4_REPORT.md` مقروء.
- English: Confirm the target commit is reviewed, buildable, and Phase 4 report is understood.

Verify / تحقق:
- `git status` clean except documentation-only operator notes.
- `corepack pnpm run build:prod` passed on the release commit or Cloud Build build passed.
- No `.env` file is committed.

If it fails / إذا فشل:
- Stop. Do not deploy.
- Fix the release branch before creating infrastructure.

## 1. Create Cloud SQL Postgres 16

What to do / ماذا تعمل:
- Arabic: أنشئ Cloud SQL PostgreSQL 16 بأصغر طبقة حالياً `db-f1-micro`.
- English: Create a Cloud SQL PostgreSQL 16 instance using the smallest tier for now, `db-f1-micro`.

Suggested command:

```bash
PROJECT_ID="khadamatk-auth"
REGION="us-central1"
INSTANCE="khadamatak-prod"

gcloud sql instances create "$INSTANCE" \
  --project="$PROJECT_ID" \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-size=10GB \
  --storage-type=SSD \
  --availability-type=zonal \
  --backup-start-time=03:00 \
  --enable-point-in-time-recovery
```

Verify / تحقق:
- Instance status is `RUNNABLE`.
- Automated backups are enabled.
- PITR is enabled.

If it fails / إذا فشل:
- Check billing, Cloud SQL Admin API, IAM permissions.
- Do not continue until the instance is healthy.

## 2. Create database and capture `DATABASE_URL`

What to do / ماذا تعمل:
- Arabic: أنشئ قاعدة الإنتاج ومستخدم التطبيق، ثم احفظ رابط الاتصال في Secret Manager.
- English: Create the production database and app user, then store the connection string in Secret Manager.

Suggested commands:

```bash
DB_NAME="khadamatak_prod"
DB_USER="khadamatak_app"

gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" --project="$PROJECT_ID"
gcloud sql users create "$DB_USER" --instance="$INSTANCE" --project="$PROJECT_ID" --password="<GENERATE_STRONG_PASSWORD>"
```

Connection name format:

```text
PROJECT_ID:REGION:INSTANCE
```

Secret example:

```text
DATABASE_URL=postgres://khadamatak_app:<PASSWORD>@127.0.0.1:5432/khadamatak_prod
```

Verify / تحقق:
- Database exists.
- User exists.
- Secret Manager has `DATABASE_URL`.
- Do not print the full URL after storing it.

If it fails / إذا فشل:
- Rotate the password if it was exposed.
- Recreate the Secret Manager version with the correct value.

## 3. Set up Cloud SQL Auth Proxy locally for migrations

What to do / ماذا تعمل:
- Arabic: شغل Cloud SQL Auth Proxy محلياً حتى تطبق migrations بأمان من جهاز المشغّل.
- English: Run Cloud SQL Auth Proxy locally so migrations can be applied safely by the operator.

```bash
CONNECTION_NAME="khadamatk-auth:us-central1:khadamatak-prod"
cloud-sql-proxy "$CONNECTION_NAME" --port 5432
```

In a second terminal:

```bash
export DATABASE_URL="postgres://khadamatak_app:<PASSWORD>@127.0.0.1:5432/khadamatak_prod"
psql "$DATABASE_URL" -c "select current_database(), now();"
```

Verify / تحقق:
- `current_database()` returns `khadamatak_prod`.
- Host is local proxy, not public DB address.

If it fails / إذا فشل:
- Confirm `roles/cloudsql.client`.
- Confirm the instance connection name.
- Confirm Cloud SQL Auth Proxy version and local port availability.

## 4. Apply migrations one-by-one

What to do / ماذا تعمل:
- Arabic: طبق كل migration بالترتيب، ولا تطبق الكل دفعة واحدة في أول إنتاج.
- English: Apply each migration in order. Do not run the full batch blindly on first production.

Recommended safe pattern:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/drizzle/0000_faithful_vance_astro.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/drizzle/0001_common_serpent_society.sql
```

After every file:

```bash
psql "$DATABASE_URL" -c "select count(*) from information_schema.tables where table_schema='public';"
psql "$DATABASE_URL" -c "select now();"
```

Migration order and purpose:

| Order | File | Creates / changes |
|---:|---|---|
| 1 | `0000_faithful_vance_astro.sql` | Base schema: workspaces, users, RBAC, billing plans/subscriptions, files, finance, outbox_events, contacts, conversations, messages, tickets, tasks, followups, opportunities, orders, payments, debts, knowledge, AI, reports, audit, sessions. |
| 2 | `0001_common_serpent_society.sql` | Safe type cleanup for `report_definitions.is_archived` and `team_id` UUID FKs on conversations/tickets. |
| 3 | `0002_wandering_microchip.sql` | Integration reliability spine: provider_accounts, provider_secret_refs, webhook_events, inbound_event_links, outbox_messages, delivery attempts, integration health/errors, idempotency, dead letters. |
| 4 | `0003_critical_indexes.sql` | Tenant/index performance improvements and idempotency compatibility columns/indexes. |
| 5 | `0004_phase2_modules.sql` | WhatsApp templates, template versions, broadcasts, broadcast recipients, automations, automation runs. |
| 6 | `0005_broadcast_outbox_idempotency.sql` | Outbox event idempotency key and entity indexes. |
| 7 | `0006_agent_settings.sql` | Agent model settings: temperature, max output tokens, knowledge base IDs. |
| 8 | `0007_domain_events.sql` | Domain events table and indexes for automation/outbox processing. |
| 9 | `0008_inbox_depth.sql` | Quick replies, saved views, SLA rules, business hours. |
| 10 | `0009_settings_depth.sql` | Notification preferences and API keys. |
| 11 | `0010_agent_memory.sql` | Agent memory snapshots per conversation/agent. |
| 12 | `0011_phase4_vectors.sql` | Knowledge retrieval: pgvector attempt, lexical `tsv`, chunk indexes, update trigger. |
| 13 | `0012_phase4_trust_mode.sql` | Agent trust mode columns and auto_reply_decisions audit table. |
| 14 | `0013_phase4_realtime_health.sql` | service_heartbeats table for outbox-worker readiness. |

Verify / تحقق:
- Each file exits 0.
- No `DROP` or unexpected destructive operation is executed manually.
- Required tables exist after their migration.
- For `0011`, if pgvector is unavailable, the NOTICE is acceptable; lexical fallback remains valid.

If it fails / إذا فشل:
- Stop at the failing file.
- Do not skip ahead.
- Use `ROLLBACK_PLAN.md` for the matching migration.
- If production contains no real customer data yet, restore from backup/snapshot if simpler.

## 5. Run seed for permissions, roles, and plans

What to do / ماذا تعمل:
- Arabic: شغل seed عبر بدء api-server أو عبر سكربت داخلي إن توفر. حالياً `runSeed()` يعمل عند بدء `api-server`.
- English: Run the seed through api-server startup or an explicit internal runner if one is added later. Currently `runSeed()` runs on api-server startup.

Safe operator approach:

```bash
DATABASE_URL="$DATABASE_URL" PORT=8080 SESSION_SECRET="<TEMP_64_CHAR_SECRET>" NODE_ENV=production SERVE_STATIC=false \
corepack pnpm --filter @workspace/api-server run build
```

Then start once in a controlled shell if needed:

```bash
DATABASE_URL="$DATABASE_URL" PORT=8080 SESSION_SECRET="<TEMP_64_CHAR_SECRET>" NODE_ENV=production SERVE_STATIC=false \
corepack pnpm --filter @workspace/api-server run start
```

Stop after logs show seed complete.

Verify / تحقق:

```sql
SELECT count(*) FROM permissions;
SELECT slug FROM roles WHERE is_system = true ORDER BY slug;
SELECT slug FROM plans ORDER BY slug;
```

If it fails / إذا فشل:
- Stop startup.
- Check that all migrations are applied.
- Check DB user permissions.
- Do not register users until seed is successful.

## 6. Build and push api-server Docker image

What to do / ماذا تعمل:
- Arabic: ابنِ صورة التطبيق وادفعها إلى Artifact Registry.
- English: Build and push the api-server image to Artifact Registry.

```bash
PROJECT_ID="khadamatk-auth"
REGION="us-central1"
REPOSITORY="khadamatak"
IMAGE="app"
TAG="$(git rev-parse --short HEAD)"

gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" || true

docker build -t "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE:$TAG" .
docker push "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE:$TAG"
```

Verify / تحقق:
- Docker build succeeds.
- Image appears in Artifact Registry.

If it fails / إذا فشل:
- Do not deploy.
- Fix build or registry permissions.

## 7. Build and push outbox-worker Docker image

What to do / ماذا تعمل:
- Arabic: ابنِ صورة worker وادفعها إلى Artifact Registry.
- English: Build and push the worker image.

```bash
WORKER_IMAGE="outbox-worker"
docker build -f Dockerfile.worker -t "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$WORKER_IMAGE:$TAG" .
docker push "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$WORKER_IMAGE:$TAG"
```

Verify / تحقق:
- Worker image exists.
- Build output includes `@workspace/outbox-worker`.

If it fails / إذا فشل:
- Do not start API readiness checks because `/api/readyz` depends on worker heartbeat.

## 8. Deploy api-server to Cloud Run

What to do / ماذا تعمل:
- Arabic: انشر خدمة API مع المتغيرات والأسرار المطلوبة.
- English: Deploy api-server Cloud Run with required env vars and secrets.

Required env vars/secrets:

```text
NODE_ENV=production
PORT=8080
SERVE_STATIC=true
ALLOWED_ORIGINS=https://<final-domain>
LOG_LEVEL=info
AI_PROVIDER=vertex
VERTEX_PROJECT_ID=<PROJECT_ID>
VERTEX_LOCATION=us-central1
VERTEX_MODEL=gemini-2.5-flash
VERTEX_EMBEDDING_MODEL=text-embedding-005
AI_MAX_OUTPUT_TOKENS=1024
AI_TEMPERATURE=0.2
AI_EMBEDDINGS_DRY_RUN=false
META_DRY_RUN=true
BASE_PATH=/
```

Secrets:

```text
DATABASE_URL
SESSION_SECRET
META_APP_ID
META_APP_SECRET
META_VERIFY_TOKEN
META_SYSTEM_USER_TOKEN
```

Deploy:

```bash
gcloud run deploy khadamatak-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE:$TAG" \
  --platform=managed \
  --port=8080 \
  --allow-unauthenticated \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-env-vars=NODE_ENV=production,PORT=8080,SERVE_STATIC=true,ALLOWED_ORIGINS=https://<final-domain>,LOG_LEVEL=info,AI_PROVIDER=vertex,VERTEX_PROJECT_ID="$PROJECT_ID",VERTEX_LOCATION="$REGION",VERTEX_MODEL=gemini-2.5-flash,VERTEX_EMBEDDING_MODEL=text-embedding-005,AI_MAX_OUTPUT_TOKENS=1024,AI_TEMPERATURE=0.2,AI_EMBEDDINGS_DRY_RUN=false,META_DRY_RUN=true,BASE_PATH=/ \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,SESSION_SECRET=SESSION_SECRET:latest,META_APP_ID=META_APP_ID:latest,META_APP_SECRET=META_APP_SECRET:latest,META_VERIFY_TOKEN=META_VERIFY_TOKEN:latest,META_SYSTEM_USER_TOKEN=META_SYSTEM_USER_TOKEN:latest
```

Verify / تحقق:
- Revision becomes ready.
- Logs do not print secrets.
- Seed logs complete.

If it fails / إذا فشل:
- Roll back to previous revision if one exists.
- Otherwise set service traffic to 0 and inspect logs.

## 9. Deploy outbox-worker to Cloud Run

What to do / ماذا تعمل:
- Arabic: انشر worker كخدمة مستقلة مع min-instances=1 وCPU always allocated.
- English: Deploy worker separately with min-instances=1 and CPU always allocated.

```bash
gcloud run deploy khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$WORKER_IMAGE:$TAG" \
  --platform=managed \
  --port=8080 \
  --min-instances=1 \
  --max-instances=1 \
  --no-cpu-throttling \
  --set-env-vars=NODE_ENV=production,PORT=8080,META_DRY_RUN=true \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest
```

Verify / تحقق:
- Worker revision is ready.
- `service_heartbeats` updates every 15 seconds.

```sql
SELECT service_name, last_beat_at, now() - last_beat_at AS age
FROM service_heartbeats
WHERE service_name='outbox-worker';
```

If it fails / إذا فشل:
- Keep `META_DRY_RUN=true`.
- Fix worker deployment before relying on `/api/readyz`.

## 10. Verify `/api/livez`

What to do / ماذا تعمل:
- Arabic: اختبر liveness.
- English: Check liveness.

```bash
SERVICE_URL="$(gcloud run services describe khadamatak-api --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
curl -i "$SERVICE_URL/api/livez"
```

Verify / تحقق:
- HTTP 200.
- JSON indicates process is alive.

If it fails / إذا فشل:
- Check Cloud Run logs and port 8080.
- Roll back revision if it worked before.

## 11. Verify `/api/readyz`

What to do / ماذا تعمل:
- Arabic: اختبر readiness الصارم: قاعدة البيانات وheartbeat للـ worker.
- English: Check strict readiness: DB and worker heartbeat.

```bash
curl -i "$SERVICE_URL/api/readyz"
```

Verify / تحقق:
- HTTP 200.
- `db` is OK.
- Worker heartbeat is fresh.

If it fails / إذا فشل:
- If DB fails: verify `DATABASE_URL`, Cloud SQL instance binding, DB migrations.
- If `outbox-worker-stale`: verify worker service is running and can reach DB.

## 12. Create Meta App and capture APP_ID/APP_SECRET

What to do / ماذا تعمل:
- Arabic: أنشئ Meta app في developers.facebook.com، فعّل WhatsApp، واحفظ APP_ID/APP_SECRET في Secret Manager.
- English: Create Meta App, enable WhatsApp, and store APP_ID/APP_SECRET in Secret Manager.

Verify / تحقق:
- App is in dev mode initially.
- WhatsApp product is configured.
- Secrets exist without exposing values.

If it fails / إذا فشل:
- Do not disable DRY_RUN.
- Resolve Meta app permissions first.

## 13. Update Cloud Run env vars

What to do / ماذا تعمل:
- Arabic: حدّث API وworker بأسرار Meta. أبقِ `META_DRY_RUN=true` حتى نهاية الاختبار.
- English: Update API and worker with Meta secrets. Keep `META_DRY_RUN=true` until smoke test is clean.

```bash
gcloud run services update khadamatak-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --set-secrets=META_APP_ID=META_APP_ID:latest,META_APP_SECRET=META_APP_SECRET:latest,META_VERIFY_TOKEN=META_VERIFY_TOKEN:latest,META_SYSTEM_USER_TOKEN=META_SYSTEM_USER_TOKEN:latest \
  --set-env-vars=META_DRY_RUN=true

gcloud run services update khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --set-secrets=META_SYSTEM_USER_TOKEN=META_SYSTEM_USER_TOKEN:latest \
  --set-env-vars=META_DRY_RUN=true
```

Verify / تحقق:
- New revisions ready.
- Logs do not print token values.

If it fails / إذا فشل:
- Revert the env var revision.
- Rotate exposed secrets if any value was accidentally printed.

## 14. Configure Meta webhook URL

What to do / ماذا تعمل:
- Arabic: اربط webhook على Meta إلى مسار المنصة.
- English: Point Meta webhook to the platform endpoint.

Webhook URL:

```text
https://<api-domain>/api/webhooks/meta
```

Verify token:

```text
META_VERIFY_TOKEN
```

Verify / تحقق:
- Meta verification challenge succeeds.
- Cloud Run logs show verification without secret values.

If it fails / إذا فشل:
- Check `META_VERIFY_TOKEN`.
- Check public HTTPS domain.
- Check Cloud Run unauthenticated access for webhook endpoint.

## 15. Test inbound message with Meta test number

What to do / ماذا تعمل:
- Arabic: أرسل رسالة نصية من رقم اختبار Meta إلى رقم الاختبار.
- English: Send a text message from Meta test sender to the test number.

Verify / تحقق:
- Webhook returns 2xx.
- `webhook_events` receives one row.
- `messages` receives inbound row.
- `conversations` opens or updates.

SQL:

```sql
SELECT id, provider, status, received_at
FROM webhook_events
ORDER BY received_at DESC
LIMIT 5;

SELECT id, direction, source, content, created_at
FROM messages
ORDER BY created_at DESC
LIMIT 5;
```

If it fails / إذا فشل:
- Check HMAC signature and `META_APP_SECRET`.
- Check channel account/provider config phone number ID.
- Keep `META_DRY_RUN=true`.

## 16. Verify domain event, message, and memory

What to do / ماذا تعمل:
- Arabic: تأكد أن الرسالة دخلت حلقة التشغيل: domain event ثم ذاكرة الوكيل.
- English: Confirm the inbound message entered the operational loop: domain event then agent memory.

SQL:

```sql
SELECT event_type, status, created_at
FROM domain_events
ORDER BY created_at DESC
LIMIT 10;

SELECT conversation_id, agent_id, jsonb_array_length(recent_turns) AS turns, updated_at
FROM agent_memory_snapshots
ORDER BY updated_at DESC
LIMIT 10;
```

Verify / تحقق:
- `domain_events.event_type = 'message.received'`.
- `agent_memory_snapshots` appears after running draft reply or agent flow.
- `auto_reply_decisions` defaults to `suggest_only` while trust mode remains `suggest`.

If it fails / إذا فشل:
- Check AI agent binding to workspace/knowledge base.
- Keep auto-send disabled.
- Run manual smoke from `SMOKE_AFTER_DEPLOY.md`.

## 17. Only after a clean pilot: disable DRY_RUN carefully

What to do / ماذا تعمل:
- Arabic: لا تطفئ DRY_RUN إلا بعد اختبار عميل داخلي كامل وقرار من المالك.
- English: Do not turn off DRY_RUN until the owner approves after an internal test.

```bash
gcloud run services update khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --set-env-vars=META_DRY_RUN=false
```

Verify / تحقق:
- One controlled outbound test succeeds.
- Message delivery status updates.
- No repeated duplicate sends.

If it fails / إذا فشل:
- Immediately set `META_DRY_RUN=true`.
- Review outbox dead letters and Meta app logs.
