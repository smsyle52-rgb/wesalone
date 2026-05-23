# Launch Readiness

## What Works End To End

- تسجيل حساب جديد مع trial تلقائي.
- تسجيل الدخول والجلسات المحمية.
- لوحة التحكم، العملاء، المحادثات، الطلبات، المدفوعات، الديون، المعرفة، الوكلاء، التقارير، الكتالوج.
- Embedded Signup وتجهيز قنوات Meta من جهة الكود.
- Webhook verification العام لـ Meta.
- استقبال رسائل Meta عندما تكون بيانات التطبيق والـwebhooks مفعلة.
- outbox-worker مع heartbeat وreadyz يعتمد عليه.
- migrations idempotent داخل Cloud Build قبل deploy.
- الفوترة اليدوية، خطط الأسعار، طلبات الدفع، ومراجعة الدفع.
- التنبيهات داخل التطبيق والبريد بنمط DRY_RUN عند غياب مزود البريد.

## DRY_RUN vs Live

- Meta:
  - DRY_RUN عند غياب `META_APP_SECRET` أو ضبط `META_DRY_RUN=true`.
  - Live يحتاج `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, tokens والقنوات المعتمدة.
- Email:
  - DRY_RUN عند غياب `EMAIL_WEBHOOK_URL` أو ضبط `EMAIL_DRY_RUN=true`.
  - Live يحتاج مزود بريد موثوق أو endpoint إرسال transactional.
- AI:
  - Vertex/Gemini يعمل حسب متغيرات AI وبيانات GCP.
  - أي غياب credentials يجب أن يبقى واضحاً في provider status.
- Billing:
  - الدفع يدوي فقط. لا يوجد gateway آلي بعد.

## Meta Dependencies

- App Review للأذونات المطلوبة من Meta.
- إعداد Webhook Callback URL في Meta Console.
- ضبط Verify Token مطابق لـ `META_VERIFY_TOKEN`.
- التأكد من أن أرقام واتساب أو صفحات Instagram/Messenger مرتبطة بتطبيق الاختبار أو التطبيق الحي.
- inbound WhatsApp الحقيقي يعتمد على موافقة Meta وربط الرقم.

## Operator Remaining Steps

1. تشغيل backup قبل أي migration على production.
2. التأكد أن Cloud Build نجح على آخر commit.
3. تطبيق migration bundle عبر Cloud Build أو يدوياً على staging ثم production حسب الخطة.
4. إعداد `PUBLIC_BASE_URL` للنطاق النهائي.
5. ربط `wesalone.com` في Cloud Run وتحديث DNS.
6. تحديث Meta OAuth Redirect URI وWebhook URL للنطاق النهائي.
7. تفعيل مزود البريد live أو قبول DRY_RUN أثناء التجارب.
8. تشغيل smoke test للصحة: `/api/livez` و`/api/readyz`.
9. اختبار رحلة merchant كاملة: التسجيل، الربط، الرسالة الواردة، رد الوكيل، التنبيه، والفوترة اليدوية.

## Not Yet Live / Deferred

- بوابة دفع آلية.
- Telegram provider.
- Voice reply وWhatsApp calls.
- Spline/Next landing المستقلة لم تدخل نشر Cloud Run الحالي.

## Launch Recommendation

المنصة جاهزة لتجارب staging محكومة مع تجار مختارين. قبل العملاء المدفوعين الحقيقيين يجب إنهاء ربط النطاق، إعداد البريد live، وتأكيد موافقات Meta وربط الأرقام.
