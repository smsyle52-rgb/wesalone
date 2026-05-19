# Khadamatak Rollback Plan

> Use this only when a deployment or migration fails. Emergency contact: owner only.

## 1. Cloud Run revision rollback

List revisions:

```bash
PROJECT_ID="khadamatk-auth"
REGION="us-central1"

gcloud run revisions list \
  --service=khadamatak-api \
  --project="$PROJECT_ID" \
  --region="$REGION"
```

Rollback API traffic:

```bash
gcloud run services update-traffic khadamatak-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions=<KNOWN_GOOD_REVISION>=100
```

Rollback worker traffic:

```bash
gcloud run revisions list \
  --service=khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION"

gcloud run services update-traffic khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions=<KNOWN_GOOD_WORKER_REVISION>=100
```

Verify:

```bash
curl -i https://<api-domain>/api/livez
curl -i https://<api-domain>/api/readyz
```

## 2. Emergency stop for outbound sends

If Meta integration misbehaves, switch DRY_RUN back on:

```bash
gcloud run services update khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --set-env-vars=META_DRY_RUN=true

gcloud run services update khadamatak-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --set-env-vars=META_DRY_RUN=true
```

Then pause processing by setting worker min instances to 0 only if needed:

```bash
gcloud run services update khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --min-instances=0 \
  --max-instances=1
```

Re-enable after investigation:

```bash
gcloud run services update khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --min-instances=1 \
  --no-cpu-throttling
```

## 3. Migration rollback principles

- Prefer restoring from Cloud SQL backup/snapshot during first production launch if the database has no real customer data.
- Do not run table drops when customer data exists unless owner explicitly approves.
- If a migration fails halfway, stop and inspect. Do not skip ahead.
- These SQL snippets are emergency-only and assume the failed migration created no valuable customer data yet.

## 4. Disable a specific migration manually

### `0000_faithful_vance_astro.sql`

This is the base schema. If it fails on a new empty DB, the safest rollback is to delete and recreate the database.

```bash
gcloud sql databases delete khadamatak_prod --instance=khadamatak-prod --project="$PROJECT_ID"
gcloud sql databases create khadamatak_prod --instance=khadamatak-prod --project="$PROJECT_ID"
```

### `0001_common_serpent_society.sql`

Rollback SQL exists in the migration comments. Use only if the type conversion was applied and must be reversed:

```sql
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" DROP DEFAULT;
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DATA TYPE text USING (is_archived::text);
ALTER TABLE "report_definitions" ALTER COLUMN "is_archived" SET DEFAULT 'false';
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_team_id_teams_id_fk";
ALTER TABLE "conversations" ALTER COLUMN "team_id" SET DATA TYPE text;
ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_team_id_teams_id_fk";
ALTER TABLE "tickets" ALTER COLUMN "team_id" SET DATA TYPE text;
```

### `0002_wandering_microchip.sql`

Emergency drop of integration spine tables:

```sql
DROP TABLE IF EXISTS provider_delivery_attempts CASCADE;
DROP TABLE IF EXISTS outbox_messages CASCADE;
DROP TABLE IF EXISTS inbound_event_links CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS provider_secret_refs CASCADE;
DROP TABLE IF EXISTS integration_error_events CASCADE;
DROP TABLE IF EXISTS integration_health_checks CASCADE;
DROP TABLE IF EXISTS dead_letter_events CASCADE;
DROP TABLE IF EXISTS provider_accounts CASCADE;
```

Do not drop `idempotency_keys` here if later migrations depend on it; inspect first.

### `0003_critical_indexes.sql`

Emergency disable indexes/compatibility table:

```sql
DROP INDEX IF EXISTS idx_contacts_ws;
DROP INDEX IF EXISTS idx_contacts_ws_created;
DROP INDEX IF EXISTS idx_conv_ws_status;
DROP INDEX IF EXISTS idx_conv_ws_assigned;
DROP INDEX IF EXISTS idx_conv_ws_lastmsg;
DROP INDEX IF EXISTS idx_msg_conv_created;
DROP INDEX IF EXISTS idx_msg_ws_provider;
DROP INDEX IF EXISTS idx_tickets_ws_status;
DROP INDEX IF EXISTS idx_tasks_ws_status_due;
DROP INDEX IF EXISTS idx_followups_ws_sched;
DROP INDEX IF EXISTS idx_orders_ws_status;
DROP INDEX IF EXISTS idx_payments_ws_status;
DROP INDEX IF EXISTS idx_outbox_events_status;
DROP INDEX IF EXISTS idx_outbox_msgs_status;
DROP INDEX IF EXISTS idx_audit_ws_created;
DROP INDEX IF EXISTS idx_contact_channels_normalized;
DROP INDEX IF EXISTS idx_idempotency_expires;
```

Do not drop `idempotency_keys` if `0002` created it in the active schema.

### `0004_phase2_modules.sql`

```sql
DROP TABLE IF EXISTS automation_runs CASCADE;
DROP TABLE IF EXISTS automations CASCADE;
DROP TABLE IF EXISTS broadcast_recipients CASCADE;
DROP TABLE IF EXISTS broadcasts CASCADE;
DROP TABLE IF EXISTS template_versions CASCADE;
DROP TABLE IF EXISTS whatsapp_templates CASCADE;
```

### `0005_broadcast_outbox_idempotency.sql`

```sql
DROP INDEX IF EXISTS uq_outbox_events_workspace_idempotency;
DROP INDEX IF EXISTS idx_outbox_events_entity;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS idempotency_key;
```

### `0006_agent_settings.sql`

```sql
ALTER TABLE ai_agents DROP COLUMN IF EXISTS temperature;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS max_output_tokens;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS knowledge_base_ids;
```

### `0007_domain_events.sql`

```sql
DROP TABLE IF EXISTS domain_events CASCADE;
```

### `0008_inbox_depth.sql`

```sql
DROP TABLE IF EXISTS business_hours CASCADE;
DROP TABLE IF EXISTS sla_rules CASCADE;
DROP TABLE IF EXISTS saved_views CASCADE;
DROP TABLE IF EXISTS quick_replies CASCADE;
```

### `0009_settings_depth.sql`

```sql
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
```

### `0010_agent_memory.sql`

```sql
DROP TABLE IF EXISTS agent_memory_snapshots CASCADE;
```

### `0011_phase4_vectors.sql`

```sql
DROP TRIGGER IF EXISTS trg_knowledge_chunks_tsv_update ON knowledge_chunks;
DROP FUNCTION IF EXISTS knowledge_chunks_tsv_update();
DROP INDEX IF EXISTS idx_chunks_embedding;
DROP INDEX IF EXISTS idx_chunks_tsv;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS tsv;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedded_at;
```

Do not drop the `vector` extension if other databases or future features use it.

### `0012_phase4_trust_mode.sql`

```sql
DROP TABLE IF EXISTS auto_reply_decisions CASCADE;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS trust_mode;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS trust_confidence_threshold;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS trust_topics;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS trust_blocklist;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS max_auto_replies_per_conversation;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS escalate_after_failed_auto;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS daily_auto_send_quota;
```

### `0013_phase4_realtime_health.sql`

```sql
DROP TABLE IF EXISTS service_heartbeats CASCADE;
```

## 5. If the app starts but `/api/readyz` fails

Likely causes:
- DB cannot be reached.
- Migrations missing.
- Worker heartbeat stale.

Fix order:
1. Check Cloud Run logs.
2. Check `DATABASE_URL` Secret Manager binding.
3. Check worker revision and `service_heartbeats`.
4. Keep API live only if `/api/livez` works and operator accepts degraded mode.

## 6. If duplicate outbound messages happen

Immediate actions:

```bash
gcloud run services update khadamatak-outbox-worker \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --set-env-vars=META_DRY_RUN=true
```

Then inspect:

```sql
SELECT id, event_type, idempotency_key, status, attempts, created_at
FROM outbox_events
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC;

SELECT id, decision, reason, confidence, topic_detected, created_at
FROM auto_reply_decisions
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC;
```

Owner decides whether to clear pending outbox rows. Do not delete customer data casually.
