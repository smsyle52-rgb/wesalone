# WESAL ONE — الحالة الحيّة
آخر تحديث: 15 يونيو 2026 (v1 الأساس مكتمل ومنشور — كل النطاقات 1–3 + PD-1…PD-6 + H5-1 في الإنتاج)

## ✅ v1 الأساس — الحالة الكاملة (15 يونيو 2026)
جميع هذه commits مدفوعة لـmain ومنشورة في Cloud Run:

| Commit | المحتوى |
|---|---|
| `739cca0` | security: حماية `.env` من git (النطاق 3) |
| `4123883` | fix(scope-1): session security, rate limiting, CORS hardening (النطاق 1) |
| `4f804e4` | fix(scope-2+4): tenant isolation + channel resilience hardening (النطاق 2) |
| PD-2 commit | رد الوكيل يظهر في الوارد عبر SSE |
| PD-1 commit | الإرسال اليدوي يصل للعميل عبر outbox |
| H5-1 commit | تصعيد صامت عند غياب AI (محمية #10) |
| PD-6 commit | Instagram + Messenger: استقبال + ربط + إرسال |
| PD-3 commit | الوسائط الواردة تُحفظ في DB مع attachments |

**النطاق النشط التالي: النطاق 4 — مُغلق ✅ (بنود النطاق 4 اكتملت)**

## النطاق 4 — متانة القنوات (البنود المتبقية) ✅ (جلسة 15 يونيو 2026)

### M4-1 — توحيد اسم سر HMAC التوقيع
السبب: `meta.routes.ts` كان يقرأ `META_WEBHOOK_SECRET` فقط — لو ضُبط `META_APP_SECRET` (الاسم المعياري من Meta) بقيمة مختلفة → HMAC يفشل صامتاً وكل الواردات تُتجاهل.
الإصلاح:
- `env.ts`: أضفنا `META_APP_SECRET = optionalEnv("META_APP_SECRET")` وصدّرناه
- `meta.routes.ts:122`: `const secret = env.META_APP_SECRET ?? env.META_WEBHOOK_SECRET;` — يقبل كليهما، الأولوية للاسم المعياري من Meta
خطة التراجع: أزِل `META_APP_SECRET` من env.ts وأعِد السطر لـ`env.META_WEBHOOK_SECRET` فقط.

### Q2 — إرسال القوالب (Templates)
السبب: `outbox-worker` لا يحتوي handler لـ`message.send.whatsapp.template` — يفشل عند `if (!text)` ثم يُعيد المحاولة 3 مرات بلا جدوى.
الإصلاح في `artifacts/outbox-worker/src/index.ts`:
- أضفنا `sendWhatsAppTemplate({phoneNumberId, to, templateName, language, components})` — يستدعي Graph API بحمولة `{type:"template", template:{name,language:{code},components}}`
- في `handleOutboxEvent` WhatsApp path: إذا `event.event_type === "message.send.whatsapp.template"` → يستخرج `templateName/language/components` من الحمولة → يستدعي `sendWhatsAppTemplate`
خطة التراجع: احذف دالة `sendWhatsAppTemplate` وكتلة الـif الخاصة بها في `handleOutboxEvent`.

### Q3 — فرض نافذة 24 ساعة
السبب: Meta ترفض الرسائل العادية بعد 24h (خطأ 131047). الـworker كان يُعيد المحاولة 3 مرات بلا جدوى.
الإصلاح في `artifacts/outbox-worker/src/index.ts` (قبل `sendWhatsAppText`):
- يجلب آخر رسالة واردة من `messages WHERE conversation_id=$1 AND direction='inbound'`
- إذا مضى >24h → يضع `status='failed', attempts=3` فوراً (بلا retries) + يصعّد المحادثة لـ`agent_status='human'`
خطة التراجع: احذف كتلة الفحص (Q3 fix block) قبل `sendWhatsAppText`.

### Q4 — تصعيد الفشل النهائي
السبب: `markOutboxFailedOrRetry` عند المحاولة الثالثة تضع `status='failed'` وتصمت — التاجر لا يُشعر.
الإصلاح في `markOutboxFailedOrRetry`: بعد `UPDATE outbox_events SET status='failed'` → يستخرج `conversationId` من حمولة الحدث → يُحدّث المحادثة لـ`agent_status='human'` (التاجر يراها في الوارد معلّمة يدوياً).
خطة التراجع: احذف كتلة Q4 fix من `markOutboxFailedOrRetry`.

typecheck ✅ build:prod ✅
**متبقٍّ:** commit + push بيد المالك.

**ما يختبره المالك:**
1. أرسل قالب (template) من لوحة التحكم → تأكّد وصوله للعميل عبر واتساب
2. محادثة قديمة >24h: الوكيل يردّ → تأكّد أن المحادثة تنتقل لـ«بشري» تلقائياً (لا يُرسل نص مرفوض)
3. اقطع الإنترنت/استخدم رقم خاطئ → بعد 3 محاولات: تأكّد أن المحادثة تظهر «يدوي» في الوارد

## إصلاح PD-6 — إنستغرام/ماسنجر (ثغرة 1 + 2) ✅ (جلسة 15 يونيو 2026)

### ثغرة 1 — توجيه الـwebhook
السبب: `modules/webhooks/meta.routes.ts` كان يُرسل جميع الـpayloads لـ`handleMetaPayload` التي تتعامل فقط مع بنية واتساب. رسائل IG/Messenger (بنية `entry[].messaging[]`) كانت تُتجاهل بصمت.
الإصلاح:
- أضفنا `import { handleMetaWebhook } from "../integrations/meta-webhook.handler"` في `meta.routes.ts`
- في POST handler: إذا `payload.object === "instagram" | "page"` → استدعِ `handleMetaWebhook(payload)` (يُوجّه لـ`handleInstagramWebhook`/`handleMessengerWebhook`). وإلا → المسار القديم للواتساب محفوظ.

### ثغرة 2 — embedded signup لإنستغرام وماسنجر
السبب: لم يوجد endpoint لإنشاء `channelAccountsTable` لإنستغرام/ماسنجر، فيفشل `ingestMetaChannelMessage` لعدم إيجاد الحساب.
الإصلاح في `artifacts/api-server/src/modules/integrations/integrations.routes.ts`:
- أضفنا `metaEmbeddedSignupInstagramSchema` + `metaEmbeddedSignupMessengerSchema`
- `POST /meta/embedded-signup/instagram/complete`: يستبدل الكود بتوكن → يجلب page token للـlinked page → ينشئ channel account (`channelType:"instagram"`, `providerConfig:{igAccountId, pageId}`) → يشترك بـwebhook events على الـpage
- `POST /meta/embedded-signup/messenger/complete`: يستبدل الكود بتوكن → يجلب page token + اسم الـpage → ينشئ channel account (`channelType:"messenger"`, `providerConfig:{pageId}`) → يشترك بـwebhook events

خطة التراجع:
- ثغرة 1: احذف السطر `import { handleMetaWebhook }` وأعد `try` block لـ`await handleMetaPayload(payload)` مباشرة.
- ثغرة 2: احذف كتلتَي `router.post("/meta/embedded-signup/instagram/complete", ...)` و`router.post("/meta/embedded-signup/messenger/complete", ...)` والـschemas الجديدة.

typecheck ✅ build:prod ✅

**ما يختبره المالك:**
1. في لوحة التحكم: اربط حساب إنستغرام أو ماسنجر عبر `POST /api/integrations/meta/embedded-signup/instagram/complete` (يرسل: `{code, ig_account_id, linked_page_id, username}`) → تأكّد أن صف `channel_accounts` يُنشأ في DB بـ`channel_type='instagram'`
2. أرسل رسالة من حساب إنستغرام العميل → تأكّد ظهورها في الوارد (يتطلب تنشيط الربط أولاً)
3. ثغرة 3 (الإرسال الصادر) لا تزال معلّقة — الردود لإنستغرام/ماسنجر تحتاج جلسة منفصلة

**متبقٍّ:** commit + push بيد المالك.

## إصلاح PD-6 — ثغرة 3 — إرسال IG/Messenger من outbox-worker ✅ (جلسة 15 يونيو 2026)

### الملفات المعدّلة:

**`artifacts/outbox-worker/src/index.ts`:**
- أضفنا `import { createDecipheriv, createHash }` من `node:crypto`
- أضفنا `credentials_secret_ref` و`channel_type` لـ`ChannelAccountRow` type وللـSELECT في `handleOutboxEvent` و`fetchChannelAccount`
- أضفنا `igAccountIdFromConfig()` و`pageIdFromConfig()` و`decryptTokenRef()` (يفك تشفير `enc:v1:...` باستخدام `META_OAUTH_STATE_SECRET ?? SESSION_SECRET`)
- أضفنا `sendInstagramMessage()` و`sendMessengerMessage()` (يستخدمان Graph API بـpage token)
- عدّلنا `handleOutboxEvent()`: إذا `channel_type === "instagram"` → يفك تشفير التوكن من `credentials_secret_ref` ويرسل عبر IG API؛ إذا `"messenger"` → نفس المنطق مع Messenger API؛ وإلا → المسار القديم للواتساب محفوظ

**`artifacts/api-server/src/routes/internal.routes.ts`:**
- أضفنا `channel: conversationsTable.channel` للـSELECT
- استبدلنا `"message.send.whatsapp.text"` الثابتة بـ`outboxEventType` ديناميكي: `instagram` → `message.send.instagram.text`، `messenger` → `message.send.messenger.text`، غير ذلك → `message.send.whatsapp.text`

**`artifacts/api-server/src/modules/conversations/conversations.routes.ts`:**
- أضفنا `channel: conversationsTable.channel` للـSELECT في route الرسائل اليدوية
- نفس المنطق الديناميكي لـ`eventType` في كتلة PD-1 fix

خطة التراجع (ثغرة 3):
- `outbox-worker`: أزِل الحقلَين من `ChannelAccountRow`، وعَد السطرين للـSELECT للقديم، واحذف `decryptTokenRef`/`igAccountIdFromConfig`/`pageIdFromConfig`/`sendInstagramMessage`/`sendMessengerMessage`، وأزِل كتلتَي if لـIG/Messenger في `handleOutboxEvent`
- `internal.routes.ts`: أزِل `channel` من SELECT وأعِد `"message.send.whatsapp.text"` ثابتة
- `conversations.routes.ts`: أزِل `channel` من SELECT وأعِد `"message.send.whatsapp.text"` ثابتة

typecheck ✅ build:prod ✅

**ما يختبره المالك (بعد ربط IG/Messenger عبر الـendpoints الجديدة):**
1. أرسل رسالة من IG → تأكّد وصولها في الوارد ← هذا يختبر ثغرة 1+2
2. ردّ على المحادثة من الوارد يدوياً → تأكّد وصول الرد لـIG/Messenger ← هذا يختبر ثغرة 3
3. دع الوكيل يردّ تلقائياً → تأكّد وصول رد الوكيل للعميل عبر IG/Messenger ← هذا يختبر ثغرة 3 كاملاً

**متبقٍّ:** commit + push بيد المالك. PD-6 مكتمل بثغراته الثلاث.

## النطاق 3 — الأسرار والاعتمادات ✅ (جلسة 15 يونيو 2026)
الفحص: لا أسرار hardcoded في الكود؛ `INTERNAL_SECRET` محمي بـ`timingSafeEqual` ومطلوب في الإنتاج؛ تاريخ git نظيف (لا tokens أو DB URLs مكشوفة)؛ توكنات Meta عبر Secret Manager؛ الجلسات آمنة.
الثغرة الوحيدة المصلحة: `.env` لم يكن في `.gitignore` → أضفنا `.env` + `.env.*` + `*.env.local`.
بوابة الإغلاق: ✅ صفر أسرار في الكود/اللوق/التاريخ؛ كل توكن في Secret Manager؛ المسارات الداخلية محميّة.
**متبقٍّ:** commit + push بيد المالك.

## إصلاح PD-3 — الوسائط الواردة تُحفظ في DB ✅ (جلسة 15 يونيو 2026)
السبب الجذري: `handleInboundMessage` في `meta.routes.ts` تتحقق من `message.text?.body` — إذا كانت الرسالة صورة/صوت/فيديو/مستند فلا `text.body`، فـ`content = undefined` → الرسالة تُحذف بصمت. `agent-media.ts` يقرأ من `messagesTable.attachments` لكنها لا تُملأ أبداً.
الإصلاح في `artifacts/api-server/src/modules/webhooks/meta.routes.ts`:
- أضفنا `MetaMediaField` type و`extractMedia()` helper: تستخرج caption كـcontent + تبني مصفوفة `attachments` بـ`{type, media_id, mime_type, caption}` حسب نوع الوسائط
- في `handleInboundMessage`: إذا لا `textContent` → استدعِ `extractMedia(message)` لنوع image/audio/voice/video/document/sticker → استخدم caption أو `[صورة]` كـcontent
- في `insertInboundMessage`: أضفنا معامل `attachments: object[] = []` ونُدرجه في قيم INSERT
- الرسائل الصوتية/الصور/الفيديوهات تُحفظ الآن في DB مع `attachments` → الوكيل يرى السياق عبر `agent-media.ts`
خطة التراجع: احذف `MetaMediaField` type + `extractMedia()` + تعديلات `handleInboundMessage`/`insertInboundMessage` (المعامل الجديد) في `meta.routes.ts`.
ما يختبره المالك: أرسل صورة من واتساب → تأكّد ظهور رسالة `[صورة]` في خيط الوارد (لا تختفي). ⚠️ **عرض الوسائط في الواجهة** (تصيير الصورة كصورة لا كنص) تحتاج تعديل frontend — خارج هذا الإصلاح.
typecheck ✅ build:prod ✅
**متبقٍّ:** commit + push بيد المالك.

## إصلاح H5-1 — نص تجريبي لا يصل للعميل ✅ (جلسة 15 يونيو 2026)
السبب الجذري: `runAI` عند غياب Vertex/Gemini كان يُرجع `runMock` بدون `fallbackUsed:true`، و`agent-reply` لم يفحصه → نص `[وضع تجريبي]` يصل للعميل.
الإصلاح: (1) `ai-provider.ts:394` → `fallbackUsed:true` عند mock. (2) `agent-reply.ts:187` → لو `fallbackUsed` → يُصعّد للبشر بصمت ويُسجّل run=failed بلا إرسال للعميل.
خطة التراجع: أعد السطر في `ai-provider.ts` لـ`return runMock(input)` واحذف كتلة الفحص في `agent-reply.ts`.
ما يختبره المالك: Gemini شغّال → الوكيل يردّ طبيعياً؛ لو Gemini قطع → المحادثة تنتقل لـ«بشري» بدون أي رسالة للعميل.
**متبقٍّ:** commit + push بيد المالك.

## إصلاح PD-1 — الإرسال اليدوي يصل للعميل ✅ (جلسة 15 يونيو 2026)
السبب الجذري: `POST /:id/messages` في `conversations.routes.ts` كان يُدرج الرسالة في DB بدون outbox event → لا تصل لواتساب.
الإصلاح في `artifacts/api-server/src/modules/conversations/conversations.routes.ts`:
- أضفنا `channelAccountId` و`externalThreadId` للـSELECT
- غيّرنا `deliveryStatus` لـ`"pending"` للرسائل الخارجة المتجهة لقناة
- أضفنا INSERT في `outboxEventsTable` بـ`idempotencyKey: "manual:{userId}:{message.id}"` بعد إدراج الرسالة
خطة التراجع: احذف كتلة PD-1 fix (السطور 698–717) وأعد `deliveryStatus: "sent"` وأزل الحقلَين من SELECT.
ما يختبره المالك: اكتب رداً يدوياً في الوارد على محادثة برايد → تأكّد وصوله على واتساب.
**متبقٍّ:** نشر commit بيد المالك + اختبار يدوي.

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
