# الطبقة 2 — حارس انجراف schema بالنشر (يحتاج مراجعة مبرمج قبل التطبيق)

> **لماذا هذا الملف:** المالك غير مبرمج. هذا التغيير يمسّ **ملف النشر** (`cloudbuild.yaml`) —
> خطأ فيه قد يوقف نشر المنصّة كلها. لذلك كُتب هنا جاهزاً ليراجعه مبرمج (أو Cursor)
> ويطبّقه ويختبره، بدل تطبيقه أعمى. (وُثّق بواسطة Claude Code، 19 يونيو 2026.)

## المشكلة (PD-12)
آلية النشر تطبّق `scripts/migrate-phase345.sql` (ملف ثابت) فقط؛ migrations جديدة في
`lib/db/drizzle/*.sql` لا تُطبّق تلقائياً. migration `0027` (`contacts.custom_fields`) نُسي
دمجه → عمود مفقود في الإنتاج → **توقّف استقبال واتساب ~5 ساعات**. وخطوة `verify-migration`
الحالية تفحص **وجود جداول فقط، لا أعمدة** — فمرّ الانجراف دون أن يوقف النشر.

## الإصلاح المطبّق فعلاً
- ✅ الأعمدة طُبّقت يدوياً على الإنتاج (الاستقبال عاد).
- ✅ 0027 دُمج في `scripts/migrate-phase345.sql` (idempotent) — يحمي القواعد الجديدة.

## المتبقّي — توسيع الحارس (هذا الملف)
في `cloudbuild.yaml`، خطوة `verify-migration`: بعد فحص الجداول، أضِف فحص **أعمدة حرجة**.
لو أي عمود متوقّع مفقود → النشر **يفشل** (يُحوّل الكارثة الصامتة إلى فشل مرئي للمطوّر).

أضِف قبل `test "$${VERIFY_RESULT}" = "6"` التالي:

```sh
        MISSING_COLS="$(PAGER=cat psql -P pager=off --no-psqlrc -v ON_ERROR_STOP=1 -tA "$${_DATABASE_URL}" -c "
          SELECT count(*) FROM (VALUES
            ('contacts','custom_fields'),('contacts','archived_at'),
            ('ai_agents','sector_key'),('ai_agents','channel_tone'),
            ('plans','price_usd'),('plans','price_yer_annual'),
            ('subscriptions','started_at'),('subscriptions','payment_method'),
            ('payment_submissions','amount_currency'),
            ('workspaces','deactivated_at')
          ) AS expected(t,c)
          LEFT JOIN information_schema.columns ic
            ON ic.table_name=expected.t AND ic.column_name=expected.c AND ic.table_schema='public'
          WHERE ic.column_name IS NULL;" | tr -d '[:space:]')"
        test "$${MISSING_COLS}" = "0"
```

## قاعدة حاكمة (تُضاف لـrunbook)
أي migration جديد:
1. يُدمج في `scripts/migrate-phase345.sql` (بصيغة `IF NOT EXISTS`).
2. يُضاف عموده الجديد لقائمة الحارس أعلاه.

## كيف يُختبر (للمبرمج)
- شغّل خطوة verify يدوياً على نسخة staging قبل الدمج في main.
- تأكّد أن `MISSING_COLS=0` على الإنتاج الحالي (مؤكّد: التدقيق أعطى 0 أعمدة مفقودة).

## التراجع
احذف الكتلة المضافة من `verify-migration`؛ لا أثر على البيانات (فحص قراءة فقط).
