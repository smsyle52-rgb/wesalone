# مراقبة وصال ون

هذا الدليل يحدد الحد الأدنى من المراقبة قبل استقبال عملاء مدفوعين. التطبيق يكتب سجلات JSON عبر `pino`، ويتضمن `request id`، وحالة الصحة عبر `/api/livez` و`/api/readyz`.

## فحوصات الصحة

- `GET /api/livez`: يؤكد أن الخادم يعمل.
- `GET /api/readyz`: يؤكد اتصال قاعدة البيانات وأن نبض `outbox-worker` حديث.
- يعتبر `outbox-worker-stale` إنذاراً تشغيلياً، لأن الرسائل الخارجية والمزامنة الدورية قد تتوقف.

## Cloud Logging Queries

أخطاء API:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-staging"
severity>=ERROR
```

طلبات بطيئة:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-staging"
jsonPayload.responseTime>2000
```

فشل webhooks:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="khadamatak-staging"
httpRequest.requestUrl:("/api/webhooks")
httpRequest.status>=400
```

أحداث outbox dead-letter:

```text
resource.type="cloud_run_revision"
textPayload:("dead_letter" OR "Outbox event failed")
```

فشل الذكاء الاصطناعي:

```text
resource.type="cloud_run_revision"
("AI provider" OR "AI run" OR "Gemini" OR "Vertex")
severity>=WARNING
```

ضرب حدود الاستخدام أو الإساءة:

```text
resource.type="cloud_run_revision"
textPayload:"Rate limit hit"
```

## Alert Policies المقترحة

- Error rate: أكثر من 5 أخطاء 5xx خلال 5 دقائق.
- Readiness: فشل `/api/readyz` مرتين متتاليتين خلال 5 دقائق.
- Outbox worker stale: ظهور `outbox-worker-stale` أو عدم تحديث `service_heartbeats` لأكثر من دقيقة.
- Webhook failures: أكثر من 10 ردود 4xx/5xx لمسار `/api/webhooks` خلال 10 دقائق.
- AI failures: أكثر من 5 تحذيرات أو أخطاء AI خلال 15 دقيقة.
- Budget alerts: عند 50 و100 و200 دولار شهرياً.

## Daily Health SQL

```sql
SELECT
  now() AS checked_at,
  (SELECT count(*) FROM workspaces WHERE status = 'active') AS active_workspaces,
  (SELECT count(*) FROM conversations WHERE created_at > now() - interval '24 hours') AS conversations_24h,
  (SELECT count(*) FROM messages WHERE created_at > now() - interval '24 hours') AS messages_24h,
  (SELECT count(*) FROM outbox_events WHERE status = 'dead_letter') AS dead_letters,
  (SELECT max(last_beat_at) FROM service_heartbeats WHERE service_name = 'outbox-worker') AS outbox_last_beat,
  (SELECT count(*) FROM notifications WHERE is_read = false) AS unread_notifications;
```

## Incident Triage

1. افحص `/api/readyz`.
2. افحص آخر revision في Cloud Run.
3. راجع Cloud Logging بالاستعلامات أعلاه.
4. افحص `outbox_events` و`service_heartbeats`.
5. إن كانت المشكلة بعد نشر جديد، ارجع إلى revision السابق من Cloud Run.
