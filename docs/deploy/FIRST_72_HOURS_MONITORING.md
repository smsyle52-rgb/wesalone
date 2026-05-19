# First 72 Hours Monitoring

Use this during the first three days after production deployment. Bookmark these checks in Google Cloud Console.

## 1. Cloud Logging queries

### API errors

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-api"
severity>=ERROR
```

Watch:
- Startup failures.
- Seed failures.
- DB connectivity errors.
- Unhandled route errors.

### Slow or failing readiness

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-api"
("readyz" OR "outbox-worker-stale" OR "Database readiness check failed")
```

Watch:
- `outbox-worker-stale`
- DB timeout
- repeated 503 readiness

### Webhook failures

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-api"
("webhook" OR "signature" OR "invalid_signature" OR "Meta webhook")
```

Watch:
- HMAC mismatch.
- Missing signature.
- Phone number ID not linked to a channel account.
- Duplicate webhook events.

### Outbox worker failures

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-outbox-worker"
("Outbox event failed" OR "dead_letter" OR "Automation engine event failed" OR "heartbeat failed")
```

Watch:
- Failed Meta sends.
- Dead-letter transitions.
- Worker DB errors.
- Automation engine failures.

### AI and Vertex failures

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-api"
("Vertex" OR "Gemini" OR "fallback" OR "AI run" OR "embedding")
```

Watch:
- Provider fallback.
- Embedding failures.
- High latency or quota errors.

## 2. Cloud SQL metrics to watch

Open Cloud SQL instance metrics and watch:

- CPU utilization.
- Memory utilization.
- Active connections.
- Storage usage.
- Read/write IOPS.
- Query latency.
- Deadlocks or lock waits if visible.
- Slow query log if enabled.

Recommended thresholds for first pilot:

| Metric | Watch level | Action |
|---|---:|---|
| CPU | >70% for 15 min | Inspect slow queries, consider tier upgrade. |
| Connections | >70% of limit | Check Cloud Run concurrency and connection pooling. |
| Storage | >80% | Increase storage before it blocks writes. |
| Readyz DB timeout | Any repeated failures | Keep worker/API in DRY_RUN and investigate. |

## 3. Cost monitoring

Create budget alerts:

- $50
- $100
- $200

Alert recipients:
- Owner only initially.

Watch cost drivers:

- Cloud Run outbox-worker min instance.
- Vertex AI text generation.
- Vertex embeddings backfill.
- Cloud SQL always-on cost.
- Cloud Logging volume if logs are too verbose.

## 4. Daily morning SQL check

Run every morning for the first 72 hours:

```sql
SELECT 
  (SELECT count(*) FROM messages WHERE created_at > now()-interval '24h' AND direction='in') as inbound,
  (SELECT count(*) FROM messages WHERE created_at > now()-interval '24h' AND direction='out') as outbound,
  (SELECT count(*) FROM auto_reply_decisions WHERE created_at > now()-interval '24h' AND decision='auto_sent') as auto_replies,
  (SELECT count(*) FROM outbox_events WHERE status='failed') as failed_outbox,
  (SELECT count(*) FROM domain_events WHERE status='failed') as failed_events;
```

Interpretation:

- `inbound`: confirms customers/messages are arriving.
- `outbound`: confirms worker is producing outbound records.
- `auto_replies`: should be 0 while trust mode is still suggest-only.
- `failed_outbox`: must be investigated immediately.
- `failed_events`: automation/domain event processing issues.

## 5. Additional useful SQL

### Worker heartbeat freshness

```sql
SELECT service_name, last_beat_at, now() - last_beat_at AS age, metadata
FROM service_heartbeats;
```

Expected:
- `outbox-worker` age less than 60 seconds.

### Webhook event status

```sql
SELECT provider, status, count(*)
FROM webhook_events
WHERE received_at > now() - interval '24 hours'
GROUP BY provider, status
ORDER BY provider, status;
```

### Auto-reply reasons

```sql
SELECT decision, reason, count(*)
FROM auto_reply_decisions
WHERE created_at > now() - interval '24 hours'
GROUP BY decision, reason
ORDER BY count(*) DESC;
```

Expected early:
- Mostly `suggest_only` with `trust_mode_off`.

### Dead letters

```sql
SELECT source_type, provider, reason, created_at
FROM dead_letter_events
WHERE resolved_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
```

## 6. Daily operator checklist

Morning:
- Check `/api/readyz`.
- Run daily SQL summary.
- Review outbox failures.
- Review auto-reply decisions.
- Check Cloud Run error logs.
- Check Cloud SQL CPU/connections.
- Confirm budget alert has not fired unexpectedly.

Evening:
- Confirm no stuck `pending` outbox events older than 1 hour.
- Confirm inbound webhook volume matches expected pilot activity.
- Keep trust mode as `suggest` until the owner has reviewed at least one day of conversations.
