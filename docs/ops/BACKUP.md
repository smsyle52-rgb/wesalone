# نسخ Cloud SQL الاحتياطي والاستعادة

قاعدة بيانات وصال ون تعمل على Cloud SQL PostgreSQL. قبل تشغيل أي migration على staging أو production يجب التأكد من وجود نسخة احتياطية حديثة.

## التحقق من النسخ اليومية

```bash
gcloud sql instances describe khadamatak-prod \
  --project=khadamatk-auth \
  --format="yaml(settings.backupConfiguration)"
```

يجب أن تكون `enabled: true`. يفضّل أيضاً تفعيل point-in-time recovery عند الانتقال لعملاء مدفوعين.

## إنشاء نسخة يدوية قبل تغيير حساس

```bash
gcloud sql backups create \
  --instance=khadamatak-prod \
  --project=khadamatk-auth \
  --description="manual-pre-change-$(date +%Y%m%d-%H%M)"
```

## عرض آخر النسخ

```bash
gcloud sql backups list \
  --instance=khadamatak-prod \
  --project=khadamatk-auth \
  --limit=5 \
  --format="table(id,windowStartTime,status,description)"
```

## الاستعادة

الاستعادة على نفس instance عملية حساسة وقد تستبدل الحالة الحالية. المسار الآمن:

1. أنشئ instance مؤقتة من النسخة الاحتياطية.
2. تحقق من البيانات والجداول.
3. صدّر البيانات المطلوبة أو خطط لقطع تشغيل منظم.
4. لا تستعد فوق production مباشرة إلا بعد موافقة تشغيلية صريحة.

أمر الاستعادة إلى instance بديلة يختلف حسب نوع النسخة والمنطقة، ويجب تنفيذه من Cloud Console أو عبر `gcloud sql backups restore` بعد تحديد backup id والهدف بدقة.

## ملاحظات

- لا تشغل migrations بدون نسخة حديثة.
- احتفظ بسجل وقت النسخة قبل كل نشر كبير.
- اختبر الاستعادة دورياً على بيئة غير production.
