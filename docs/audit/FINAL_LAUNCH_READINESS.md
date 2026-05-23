# Final Launch Readiness — Wesal One

Date: 2026-05-23

## Executive Summary

وصال ون جاهز تقنيًا لدعوة أول تجار مدفوعي الاشتراك على بيئة staging/production wiring الحالية، بشرط إبقاء التشغيل مراقبًا في الأسبوع الأول. المنصة أصبحت تغطي رحلة التاجر الأساسية: التسجيل، التهيئة، القنوات، الوارد، المعرفة، الوكيل الذكي، الكتالوج، الطلبات، المدفوعات اليدوية، الاشتراكات، التنبيهات، والحماية التشغيلية.

الاعتماد الخارجي الوحيد المتبقي قبل تشغيل WhatsApp live على نطاق واسع هو اعتماد تطبيق Meta والصلاحيات المطلوبة من Meta App Review.

## Complete Feature Inventory

| المجال | الحالة | ملاحظات |
|---|---|---|
| التسجيل والدخول | يعمل | تسجيل، تحقق بريد، إعادة تعيين كلمة المرور، حماية تسجيل بسيطة. |
| onboarding | يعمل | اختيار القطاع، المحافظة، وتوجيه التاجر لأول خطوات الإعداد. |
| RBAC والصلاحيات | يعمل | أدوار وصلاحيات للمسارات الأساسية، مع صفحات محمية. |
| صندوق الوارد | يعمل | محادثات، رسائل، حالات، شارات تدخل بشري، وبث لحظي SSE. |
| جهات الاتصال | يعمل | بيانات العملاء، قنوات التواصل، المدينة وملاحظة الموقع. |
| الوكيل الذكي | يعمل | سياق قطاعي، قناة الرد، معرفة التاجر، ذاكرة المحادثة، تعلم آمن، تصعيد عند عدم اليقين. |
| المعرفة/RAG | يعمل | قواعد معرفة، مستندات، chunks، بحث نصي/متجهي عند توفر embeddings. |
| Meta channels | جاهز للكود | WhatsApp/Instagram/Messenger Embedded Signup، HMAC، webhook verify، ومعالجة inbound/outbox. live يعتمد على أسرار Meta واعتماد الصلاحيات. |
| الكتالوج | يعمل كطبقة mirror | مصادر Meta، منتجات، منشورات، إعلانات، sync runs، وربط معرفة المنتجات بالوكيل. |
| الطلبات | يعمل | إنشاء ومتابعة حالة الطلبات وربطها بالعملاء والمحادثات. |
| المدفوعات التشغيلية | يعمل | تسجيل مدفوعات يدوية للطلبات، تأكيد/رفض، وسجل مالي. |
| الاشتراكات والفوترة | يعمل UI/API | خطط، حدود استخدام، تجربة، فترة سماح، مدفوعات يمنية يدوية، مراجعة إدارية. الأسعار canonical بالدولار مع عرض YER/SAR. |
| التنبيهات | يعمل | مركز تنبيهات داخل التطبيق وبريد في DRY_RUN عند غياب SMTP. |
| العامل الخلفي | يعمل | outbox، automations، catalog sync، learning، billing maintenance، heartbeat. |
| الصحة والمراقبة | موثق ومربوط | livez/readyz، heartbeat، runbooks للـ logs، alerts، backups. |
| الدومين | جاهز للتجهيز | التطبيق domain-agnostic عبر `PUBLIC_BASE_URL`، وخطوات الدومين موثقة. |
| الصفحة التسويقية الحالية | تعمل | Vite landing مدمجة في التطبيق الحالي. يوجد مشروع Next منفصل محليًا وغير منشور. |

## DRY_RUN vs Live Matrix

| التكامل | DRY_RUN | Live المطلوب |
|---|---|---|
| Meta OAuth / Embedded Signup | يمكن محاكاة النجاح عند غياب `META_APP_SECRET` | `META_APP_ID`, `META_APP_SECRET`, redirect URI صحيح، صلاحيات Meta معتمدة. |
| Meta Webhooks | verify public يعمل عند ضبط `META_VERIFY_TOKEN` | ضبط Callback URL وVerify Token في Meta Dashboard. |
| WhatsApp/Instagram/Messenger send | يسجل outbox send كـ DRY_RUN عند غياب الأسرار | Meta tokens وPhone/Page/IG IDs وصلاحيات live. |
| Catalog / posts / ads sync | يولد بيانات عينة عند غياب Meta live | `catalog_management`, `business_management`, `ads_read` وصلاحيات asset access. |
| AI provider | mock/dry-run ممكن للتطوير | Vertex/Gemini env والقيم الإنتاجية. |
| Embeddings | dry-run يحافظ على التدفق | Vertex embedding model `text-embedding-005` وأبعاد 768. |
| Email | DRY_RUN log عند غياب SMTP | SMTP أو مزود بريد معاملات مضبوط. |
| Billing payments | يدوي دائمًا | لا يوجد gateway آلي؛ التفعيل بعد مراجعة الدفع يدويًا. |

## Single Remaining Dependency

الاعتماد الوحيد غير البرمجي هو Meta App Review:

- WhatsApp Business Messaging.
- WhatsApp Business Management.
- Instagram Basic.
- Instagram Manage Messages.
- Pages Messaging.
- Pages Manage Metadata.
- Pages Show List.
- Catalog Management.
- Business Management.
- Ads Read.

بدون هذه الموافقات يمكن اختبار التدفق داخليًا/DRY_RUN، لكن لا ينبغي دعوة عملاء يعتمدون على inbound WhatsApp live قبل اكتمال Meta approval.

## Operator Final Pre-Launch Checklist

- تأكد من نجاح آخر Cloud Build على `main`.
- تأكد أن Cloud Run `khadamatak-staging` يستخدم آخر image متوقع.
- شغل `GET /api/livez` و`GET /api/readyz`.
- تأكد أن outbox-worker heartbeat غير stale.
- راجع Secret Manager دون طباعة القيم: `DATABASE_URL`, `SESSION_SECRET`, `META_TEST_APP_SECRET` أو live equivalent, SMTP إن وجد.
- تأكد أن Cloud SQL backup اليومي وPITR مفعلان.
- طبّق `scripts/migrate-phase345.sql` فقط عبر المسار التشغيلي المعتمد، ولا تستخدم `db:push`.
- اضبط `PUBLIC_BASE_URL` و`ALLOWED_ORIGINS` للدومين النهائي عند ربط الدومين.
- حدّث Meta OAuth Redirect URI وWebhook URL بعد الدومين.
- أنشئ تاجر اختبار، أكمل onboarding، أضف معرفة، اربط قناة DRY_RUN، واختبر draft reply.
- راجع صفحة الفوترة وخطة التجربة قبل دعوة أي تاجر.

## First-Week Monitoring Routine

يوميًا خلال أول أسبوع:

- صباحًا: افحص `readyz`, آخر heartbeat للـ outbox-worker، وعدد dead letters.
- بعد الظهر: راجع Cloud Logging للأخطاء ذات severity error أو critical.
- مساءً: راجع outbox backlog، webhook failures، AI failures، وطلبات التصعيد `needs_human`.
- راجع التكاليف يوميًا في GCP Billing، خصوصًا Vertex AI وCloud Run وCloud SQL.
- راجع أول 10 محادثات حقيقية يدويًا للتأكد من جودة الردود وعدم اختلاق الأسعار أو سياسات الدفع.
- راجع payment submissions pending يوميًا حتى لا ينتظر التاجر تفعيل الخطة.

## Verification

- `corepack pnpm --filter @workspace/scripts smoke:phase4`: PASS — contract DRY_RUN merchant journey.
- `corepack pnpm -r typecheck`: PASS.
- `corepack pnpm run build:prod`: PASS.

## Decision

PASS — Wesal One is ready for a controlled first-customer launch after Meta approval and final operator configuration.
