# Khadamatak Monthly Cost Estimate

This is a practical starting estimate for the first production pilot. Actual billing depends on region, traffic, logs, Vertex model choice, and message volume.

## Baseline: first 5 merchants

| Item | Assumption | Estimated monthly cost |
|---|---|---:|
| Cloud SQL Postgres `db-f1-micro` | Smallest production pilot instance, backups enabled | ~$10 |
| Cloud Run API | min=0, around 100 requests/day, request-based CPU | ~$5 |
| Cloud Run outbox-worker | min=1, always on, CPU always allocated | ~$15 |
| Vertex AI | ~1000 embeddings + 500 draft replies/day | ~$30 |
| Cloud Storage | logos and small attachments | ~$1 |
| Cloud Logging | normal pilot logging volume | ~$0-$5 |
| Total expected | first 5 merchants | ~$60/month |

## Scale points

| Scale | Expected monthly cost | Main drivers |
|---:|---:|---|
| 5 merchants | ~$60 | Worker always-on, Cloud SQL, Vertex. |
| 50 merchants | ~$200 | Vertex usage, Cloud Run requests, Cloud SQL tier upgrade. |
| 500 merchants | ~$1500 | AI volume, Cloud SQL scaling, logs, storage, worker throughput. |

## Cost controls

Set budget alerts:

- $50
- $100
- $200

Recommended controls:

- Keep `META_DRY_RUN=true` until pilot is verified.
- Keep trust mode as `suggest` for first 24 hours per merchant.
- Avoid bulk campaigns until outbox metrics are stable.
- Run embeddings backfill once, not repeatedly.
- Keep logs structured and avoid payload dumps.
- Review Vertex usage daily during first week.

## When costs increase

Expected reasons:

- More draft replies per day.
- Embedding backfills for large knowledge bases.
- Outbox-worker kept at min-instances=1.
- Cloud SQL tier upgrade from `db-f1-micro`.
- Higher Cloud Logging volume from verbose debugging.

## Upgrade triggers

Move beyond `db-f1-micro` if:

- CPU stays above 70% for 15 minutes repeatedly.
- Connection usage approaches the instance limit.
- `/api/readyz` intermittently fails due to DB latency.
- Query latency affects Inbox or webhook processing.

Consider Cloud Tasks or Pub/Sub later if:

- Outbox exceeds roughly 1k messages/minute.
- Polling becomes wasteful or slow.
- Dead-letter volume increases under campaign load.

## Notes for Yemeni pilot context

- No payment gateway is included in this estimate.
- Manual payments do not add provider transaction fees.
- Meta/WhatsApp pricing is separate and depends on Meta conversation/message pricing rules.
- SMS/voice is not included because voice channel is not built yet.
