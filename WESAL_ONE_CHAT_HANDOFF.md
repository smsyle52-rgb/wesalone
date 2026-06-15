# WESAL ONE — الحالة الحيّة
آخر تحديث: 15 يونيو 2026 (جلسة إصلاح PD-2)

## إصلاح PD-2 — رد الوكيل يظهر في الوارد ✅ (جلسة 15 يونيو 2026)
السبب الجذري: `handleOutboxEvent` كان يُرسل لميتا دون كتابة رسالة في `messages` أو بثّ SSE.
الإصلاح: أضفنا في `artifacts/api-server/src/routes/internal.routes.ts` (السطر 162–188) INSERT في `messagesTable` + `emitWorkspaceEvent("message.new")` مباشرةً بعد `runAgentReply` وقبل إدراج outbox. typecheck + build:prod ✅.
خطة التراجع: احذف الكتلة من السطر 161–188 في internal.routes.ts وأعدها لحالتها (لا تغيير في أي ملف آخر).
ما يختبره المالك: أرسل رسالة كعميل → تأكّد أن رد الوكيل يظهر في خيط الوارد فوراً بدون تحديث الصفحة.
**متبقٍّ قبل إغلاق PD-2:** نشر commit بيد المالك + اختبار يدوي.

## خطة جاهزية الإطلاق — النطاق 2 مقفل ✅
تم إغلاق نطاق عزل العملاء: أضيف `workspaceId` صريح كطبقة دفاع ثانية إلى استعلامات رسائل المحادثات، قنوات التواصل، عضوية المسند إليه، تحديثات المحادثات، `recalcTotal`، حذف/تعديل الطلبات والبنود، وتأكيد/رفض المدفوعات. وتم تقوية المواضع المشابهة في approvals/AI/integrations/debts/reports/webhook ingest/workspace preferences.
التحقق المنجز: `typecheck:libs` ✅ وartifacts/scripts typecheck ✅ و`build:prod` ✅. النطاق النشط التالي حسب المهارة: النطاق 3 — الأسرار والاعتمادات.

## خطة جاهزية الإطلاق — النطاق 1 مقفل ✅
تم إغلاق نطاق المصادقة والجلسات: تجديد session id عند login/register، حذف جلسات المستخدم عند تغيير/استعادة كلمة المرور، تفعيل `apiLimiter` العام بعد webhooks، ضبط CORS ليكون fail-closed في الإنتاج عند غياب `ALLOWED_ORIGINS`، إضافة rate limit لإعادة إرسال التحقق، تضييق `switch-workspace` على `userId + workspaceId`، وجعل `INTERNAL_SECRET` مطلوباً في الإنتاج.
التحقق المنجز: `typecheck:libs` ✅ وartifacts/scripts typecheck ✅.

## المرحلة 1 — مُغلقة ✅
الـ worker حي ويـpoll كل ثانية (revision 00018-9mw، v22، كل الأسرار كاملة).
domain_events: كلها done. outbox_events: لا failed ولا pending.
Cloud Build triggers: اثنان — khadamatak-staging + khadamatak-worker.
كل push على main ينشر الاثنين تلقائياً.

## الجذر الحقيقي للمشكلة الأولى (محلول)
الـ worker ما كان له Cloud Build trigger — ظلّ مجمّداً على كود قديم.
الحل: إنشاء trigger جديد (khadamatak-worker ← cloudbuild.worker.yaml ← main).

## إصلاح echo/statuses (محلول)
Meta delivery statuses لم تعد تُحوَّل إلى `message.echo`. الإيقاف 30 دقيقة يحدث فقط عند echo فعلي من رسالة business/Coexistence، وليس عند sent/delivered/read status receipts.

## المرحلة 2 — أدوات المهمات (قيد التثبيت) ⏳
تم تطبيق الأساس ونشره:
- `artifacts/api-server/src/lib/agent-tools.ts`: أدوات `create_order`, `log_payment_claim`, `schedule_followup`, `send_product_media`, `handoff_to_human`.
- `artifacts/api-server/src/lib/agent-reply.ts`: يطلب JSON tool calls فقط عند وجود أدوات مفعّلة، وينفذ فقط `isEnabled=true` و`requiresApproval=false`.
- `artifacts/api-server/src/routes/internal.routes.ts`: يرجع `toolResults` من `/internal/agent-reply`.
- `artifacts/outbox-worker/src/index.ts`: يدعم إرسال WhatsApp media من outbox.

التحقق المنجز: `typecheck:libs` ✅، نطاق الإنتاج بدون `mockup-sandbox` ✅، `api-server typecheck` ✅، `outbox-worker typecheck` ✅، `build:prod` ✅.
تم حسم echo/statuses في `artifacts/api-server/src/modules/webhooks/meta.routes.ts`: لا تُنشأ `message.echo` من `value.statuses`; فقط رسائل `senderType === "business"` توقف الوكيل 30 دقيقة.
تمت إضافة سكربت تفعيل آمن: `corepack pnpm --filter @workspace/scripts run enable:phase2-tools` مع `DATABASE_URL` و`AGENT_ID`، ويضبط أدوات Phase 2 الخمس على `isEnabled=true` و`requiresApproval=false` لذلك الوكيل فقط.
لم يتم التفعيل المباشر من هذه البيئة لأن `.env` غير موجود و`gcloud` غير مثبت، لذلك لا يوجد وصول آمن لقاعدة الإنتاج هنا.
المتبقي قبل بوابة الخروج: تشغيل سكربت التفعيل بقيم الإنتاج الآمنة لوكيل محدد، ثم اختبار محادثة حيّة تنتج طلباً ومتابعة بدون لمس بشري.

## المراحل المتبقية
- المرحلة 3 — جودة الاسترجاع + embeddings
- المرحلة 4 — Token resolver لكل عميل
- المرحلة 6 — مصفوفة الاختبار الشامل
- المراحل A–H (الخطة التنفيذية الشاملة)
