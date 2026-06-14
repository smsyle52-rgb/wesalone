# WESAL ONE — الحالة الحيّة
آخر تحديث: 15 يونيو 2026

## المرحلة 1 — مُغلقة ✅
الـ worker حي ويـpoll كل ثانية (revision 00018-9mw، v22، كل الأسرار كاملة).
domain_events: كلها done. outbox_events: لا failed ولا pending.
Cloud Build triggers: اثنان — khadamatak-staging + khadamatak-worker.
كل push على main ينشر الاثنين تلقائياً.

## الجذر الحقيقي للمشكلة (محلول)
الـ worker ما كان له Cloud Build trigger — ظلّ مجمّداً على كود قديم.
الحل: إنشاء trigger جديد (khadamatak-worker ← cloudbuild.worker.yaml ← main).

## المرحلة التالية النشطة ⏳
المرحلة 2 — أدوات المهمات (function calling):
create_order، log_payment_claim، schedule_followup، send_product_media، handoff_to_human.
الخطوة الأولى: فحص read-only لـ orders.routes وpayments.routes الموجودتين.

## المراحل المتبقية
- المرحلة 3 — جودة الاسترجاع + embeddings
- المرحلة 4 — Token resolver لكل عميل
- المرحلة 6 — مصفوفة الاختبار الشامل
- المراحل A–H (الخطة التنفيذية الشاملة)
