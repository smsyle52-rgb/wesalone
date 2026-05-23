# إعداد النطاق المخصص لـ Wesal One

هذا الدليل يجهز نقل الخدمة من رابط `run.app` إلى نطاق مثل `wesalone.com` بدون تغيير الكود.

## المتغيرات المطلوبة

بعد اعتماد النطاق، اجعل هذه القيم في Cloud Run:

```text
PUBLIC_BASE_URL=https://wesalone.com
ALLOWED_ORIGINS=https://wesalone.com
META_REDIRECT_URI=https://wesalone.com/api/integrations/meta/embedded-signup/callback
```

`PUBLIC_BASE_URL` هو المصدر الموحد للروابط العامة: روابط البريد، OAuth redirect الافتراضي، وCORS.

## ربط النطاق في Cloud Run

1. افتح Google Cloud Console.
2. اختر المشروع `khadamatk-auth`.
3. اذهب إلى Cloud Run ثم الخدمة `khadamatak-staging` أو خدمة الإنتاج النهائية.
4. افتح تبويب `Custom domains`.
5. اختر `Add mapping`.
6. أدخل النطاق:

```text
wesalone.com
```

7. اختر الخدمة والمنطقة `us-central1`.
8. انسخ سجلات DNS التي تعرضها Google.

## DNS

في مزود النطاق:

- أضف سجلات `A` أو `CNAME` كما تعرضها Cloud Run.
- انتظر انتشار DNS.
- تأكد أن managed SSL certificate أصبح `Active`.

## تحديث Cloud Run

بعد أن يعمل النطاق:

```bash
gcloud run services update khadamatak-staging \
  --project=khadamatk-auth \
  --region=us-central1 \
  --update-env-vars="PUBLIC_BASE_URL=https://wesalone.com,ALLOWED_ORIGINS=https://wesalone.com,META_REDIRECT_URI=https://wesalone.com/api/integrations/meta/embedded-signup/callback"
```

## تحديث Meta Developer Console

في تطبيق Meta:

- OAuth Redirect URI:

```text
https://wesalone.com/api/integrations/meta/embedded-signup/callback
```

- Webhook Callback URL:

```text
https://wesalone.com/api/webhooks/meta
```

- Verify Token: نفس قيمة `META_VERIFY_TOKEN` في Cloud Run.

## التحقق

```bash
curl -fsS https://wesalone.com/api/livez
curl -fsS https://wesalone.com/api/readyz
```

ثم افتح:

```text
https://wesalone.com
https://wesalone.com/login
https://wesalone.com/integrations
```

## ملاحظات تشغيلية

- لا تغيّر إعدادات Meta قبل أن يعمل SSL.
- احتفظ برابط `run.app` كمسار طوارئ داخلي.
- بعد النقل، حدّث أي وثائق أو روابط بريدية تشير إلى `run.app`.
