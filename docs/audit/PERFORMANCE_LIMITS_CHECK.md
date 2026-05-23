# Performance & Limits Check — Wesal One

Date: 2026-05-23

## Summary

تمت مراجعة مسارات الأداء والحدود قبل الإطلاق. النتيجة: البنية الحالية تملك الفهارس الأساسية للقراءات الحرجة، وتطبق حدود الاستخدام على المسارات المكلفة، وتشغّل العامل الخلفي بنمط آمن يمنع ازدواج المعالجة، وتحافظ على حدود سياق الذكاء الاصطناعي.

## Database Indexes

تم التحقق من وجود الفهارس الحرجة في `scripts/migrate-phase345.sql`:

- Inbox: `idx_conv_ws_status`, `idx_conv_ws_lastmsg`, `idx_msg_conv_created`, `idx_msg_ws_provider`.
- Contacts: `idx_contacts_ws`, `idx_contacts_ws_created`, `idx_contact_channels_normalized`.
- Tasks and orders: `idx_tasks_ws_status_due`, `idx_orders_ws_status`, `idx_payments_ws_status`.
- Outbox: `idx_outbox_events_status`, `idx_outbox_events_entity`, `idx_outbox_msgs_status`.
- Knowledge/RAG: `idx_chunks_tsv`, `idx_chunks_embedding`.
- Catalog: `idx_products_ws`, `idx_products_source`, `idx_products_availability`, `idx_catalog_sources_ws`, `idx_sync_runs_source`.
- Escalation and learning: `idx_conv_ws_needs_human`, `idx_auto_decisions_conv`, `idx_learned_answers_ws_status`.
- Billing: `idx_usage_counters_ws_period`, `idx_payment_submissions_ws_status`, `idx_payment_submissions_status_created`.
- Notifications/auth: `idx_notifications_user_unread`, `idx_auth_tokens_user_type`.

## Rate Limits & Plan Limits

تم التحقق من:

- `artifacts/api-server/src/lib/rateLimiter.ts` يحتوي حدودًا منفصلة للمصادقة، التسجيل، الذكاء الاصطناعي، التقارير، المدفوعات، والويبهوكات.
- `sessionOrIpKey` آمن للطلبات العامة ولا يقرأ الجلسة قبل التحقق من وجودها.
- `apiLimiter` يستثني الويبهوكات حتى لا يكسر تحقق Meta العام.
- `artifacts/api-server/src/services/billing.ts` يحتوي:
  - `checkLimit(workspaceId, limitKey)` لفحص حدود الخطة.
  - `recordUsage(workspaceId, metric)` لتسجيل الاستخدام الشهري.
  - `getLimitWarnings(workspaceId)` لإظهار التحذيرات دون تعطيل بيانات التاجر.
- إنشاء قنوات Meta يفحص حد `channels` قبل إضافة الحسابات.

## Outbox Worker Throughput

تم التحقق من `artifacts/outbox-worker/src/index.ts`:

- حجم الدفعة الحالي: `batchSize = 25`.
- فترة السحب: `pollIntervalMs = 5_000`.
- المعالجة تستخدم:
  - `FOR UPDATE SKIP LOCKED`
  - `LIMIT $1`
  - retry بتراجع أسي حتى `maxAttempts = 6`
  - heartbeat كل 15 ثانية في `service_heartbeats`
- العامل يسجل `processedLastMinute` داخل heartbeat لتسهيل المراقبة.
- عمال الكتالوج، التعلم، الفوترة، والأتمتة لديهم أقفال منطقية داخل العملية لمنع التداخل.

## AI Token & Context Bounds

تم التحقق من حدود السياق:

- ذاكرة المحادثة محدودة في `agent-memory.ts` عبر `MAX_TURNS = 20`.
- إعداد الوكيل يحتوي `max_output_tokens` افتراضيًا بقيمة `1024`.
- استرجاع المعرفة يطبق حدودًا صغيرة لكل طلب.
- سياق الإعلانات والمنشورات الحديثة محدود داخل مسار draft-reply.
- الرد التلقائي يخضع لبوابة الثقة وحدود `daily_auto_send_quota`.

## Operational Notes

- تحذير حجم bundle في Vite موجود لكنه غير مانع للإطلاق الحالي، ويوصى بتقسيم lazy chunks لاحقًا عند زيادة الواجهة.
- `artifacts/landing-next` مشروع منفصل غير داخل مسار Cloud Run الحالي، وظهوره في build المحلي لا يعني أنه منشور.
- لا يوجد تغيير قاعدة بيانات أو deploy في هذا الفحص.

## Decision

PASS — الأداء والحدود مقبولة لدعوة أول تجار مدفوعي الاشتراك مع مراقبة أسبوع الإطلاق.
