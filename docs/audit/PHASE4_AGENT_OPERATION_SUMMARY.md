# تقرير Phase 4 — حلقة تشغيل الوكلاء

## الخلاصة التنفيذية

آخر عملية أغلقت Phase 4-Operational. الهدف لم يكن إضافة صفحات جديدة، بل ربط الموجود ليعمل كحلقة تشغيل كاملة:

عميل يرسل رسالة عبر واتساب، المنصة تستقبلها، تربطها بالعميل والمحادثة، الوكيل يقرأ سياق المحادثة من الذاكرة، يسترجع إجابات من قاعدة المعرفة، يجهز رداً، ثم يقرر هل يبقى الرد اقتراحاً للموظف أو يدخل مسار إرسال تلقائي مضبوط بشروط الثقة. كل قرار يتم تسجيله.

الحالة الحالية: البنية التشغيلية جاهزة محلياً ومرّت typecheck و build:prod و smoke test في وضع DRY_RUN/contract. التشغيل الحي يحتاج تطبيق migrations على Cloud SQL وضبط أسرار Meta وربط القناة من الواجهة.

## ماذا تم بناؤه

### 1. ذاكرة الوكيل

تمت إضافة ذاكرة للمحادثة حتى لا يرد الوكيل على آخر رسالة فقط.

- جدول جديد: `agent_memory_snapshots`
- التخزين حسب: conversation + agent
- يحفظ آخر 20 دورة من المحادثة
- يحفظ ملخصاً متدحرجاً للأقدم عند تضخم السياق
- يدعم مسح الذاكرة عند الحاجة
- تم ربطه بمسار draft reply

النتيجة: الوكيل صار يرى سياق العميل السابق داخل نفس المحادثة بدلاً من التعامل مع كل رسالة كأنها منفصلة.

### 2. استرجاع المعرفة الحقيقي

تم تحسين قاعدة المعرفة من مجرد نصوص إلى طبقة استرجاع عملية.

- تم تجهيز `knowledge_chunks` للبحث النصي عبر `tsvector`
- migration يحاول تفعيل pgvector إذا كان متاحاً
- إذا pgvector غير متاح، يعمل fallback lexical
- خدمة embeddings تعمل بوضع DRY_RUN عند غياب مزود فعلي
- تم إضافة chunker لإعادة تقطيع وثائق المعرفة
- endpoint جديد: `POST /api/knowledge/search`
- draft reply يستخدم أعلى مصادر معرفة ذات صلة

النتيجة: رد الوكيل يعتمد على وثائق وFAQ فعلية بدل ردود عامة.

### 3. وضع الثقة والإرسال المنضبط

تم بناء طبقة قرار تمنع الإرسال العشوائي.

- الافتراضي دائماً: اقتراح فقط
- الإرسال التلقائي لا يحدث إلا إذا:
  - `trust_mode` ليس `suggest`
  - لا توجد كلمات حظر
  - الحصة اليومية لم تنته
  - الحد الأقصى في المحادثة لم يتجاوز
  - الموضوع ضمن المواضيع المسموحة
  - درجة الثقة أعلى من الحد
- جدول جديد: `auto_reply_decisions`
- كل قرار يسجل السبب: `trust_mode_off`, `confidence_low`, `topic_not_whitelisted`, `ok`, وغيرها
- عند السماح بالإرسال، لا يتم الاتصال بواتساب مباشرة من مسار AI؛ يتم إنشاء outbox event فقط

النتيجة: صار لدينا auto-send قابل للضبط، لكنه محافظ وشفاف ومراجع بالكامل.

### 4. استقبال واتساب إلى Inbox

تم تثبيت مسار استقبال Meta/WhatsApp داخل البنية الحالية.

- webhook يتحقق من HMAC عند وجود `META_APP_SECRET`
- الرسائل النصية الواردة تتحول إلى:
  - contact
  - contact channel
  - conversation
  - inbound message
  - domain event
- duplicate messages يتم تجاهلها عبر provider message id
- لا يتم إرسال رد خارجي أثناء التطوير

النتيجة: وصول الرسالة أصبح يدخل في حلقة المحادثات والذاكرة والأتمتة.

### 5. Inbox realtime

تمت إضافة SSE بدلاً من WebSocket.

- endpoint جديد: `GET /api/inbox/stream`
- أحداث مدعومة:
  - `message.received`
  - `conversation.assigned`
  - `conversation.status_changed`
  - `broadcast.progress`
- الواجهة تعيد الاتصال تلقائياً
- Inbox يعرض مؤشر اتصال مباشر

النتيجة: عند وصول رسالة جديدة، الواجهة مهيأة للتحديث بدون refresh.

### 6. صحة الإنتاج

تم تشديد health checks.

- endpoint جديد: `/api/livez`
- `/api/readyz` يتحقق من:
  - اتصال DB
  - heartbeat للـ outbox-worker
- جدول جديد: `service_heartbeats`
- outbox-worker يكتب heartbeat كل 15 ثانية
- توثيق Cloud Run probes في `docs/architecture/CLOUD_RUN.md`

النتيجة: Cloud Run يستطيع معرفة هل الخدمة حية فقط أو جاهزة فعلياً للتشغيل.

## الملفات والتقارير المهمة

- تقرير Phase 4 التفصيلي: `docs/audit/PHASE4_REPORT.md`
- هذا الملخص: `docs/audit/PHASE4_AGENT_OPERATION_SUMMARY.md`
- preflight inventory: `docs/audit/PHASE4_PREFLIGHT.md`
- سكربت smoke: `scripts/smoke-test.ts`
- توثيق Cloud Run: `docs/architecture/CLOUD_RUN.md`

## commits الخاصة بالعملية

- `ffd37a9` — ذاكرة الوكيل
- `7bf8e6d` — استرجاع المعرفة RAG
- `440a811` — وضع الثقة والإرسال المنضبط
- `5570a20` — realtime inbox وhealth probes
- `82af971` — smoke test وتقرير الإغلاق

## نتيجة التحقق

- `corepack pnpm --filter @workspace/scripts smoke:phase4`: PASS
- `corepack pnpm -r typecheck`: PASS
- `corepack pnpm run build:prod`: PASS
- lint: SKIPPED لأنه لا توجد lint scripts

ملاحظة مهمة: smoke test اشتغل محلياً بوضع contract-dry-run لأن `DATABASE_URL` غير موجود على الجهاز. نفس السكربت يحتوي مسار DB dry-run كامل إذا تم توفير قاعدة اختبار.

## هل الوكلاء جاهزون الآن؟

جاهزون من ناحية البنية التشغيلية:

- لديهم ذاكرة محادثة
- لديهم استرجاع معرفة
- لديهم سجل قرارات
- لديهم وضع ثقة محافظ
- لديهم مسار outbox للإرسال
- لديهم realtime inbox
- لديهم health probes

لكن ليسوا جاهزين للبيع كتشغيل حي كامل قبل هذه الخطوات التشغيلية:

1. تطبيق migrations على Cloud SQL.
2. تشغيل outbox-worker كخدمة Cloud Run مستقلة.
3. ضبط `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`.
4. ضبط Webhook في Meta.
5. ربط قناة واتساب من الواجهة.
6. تشغيل backfill للمعرفة.
7. إبقاء الوكيل أول 24 ساعة على `suggest` فقط.
8. تفعيل مواضيع الثقة بالتدرج.

## ما لم يتم بناؤه في هذه العملية

- قناة صوت.
- Telegram.
- Instagram live.
- Messenger live.
- Web Chat widget.
- Meta production call أثناء التطوير.
- 2FA backend.
- multi-region replicas.

## التقييم النهائي

Phase 4 نقلت المنصة من “واجهة فيها وكلاء” إلى “حلقة تشغيل وكلاء”:

الرسالة تدخل، تتحول إلى محادثة، الذاكرة تتحدث، المعرفة تُسترجع، الرد يُصاغ، قرار الثقة يُسجل، والإرسال إن سُمح به يمر عبر outbox لا عبر اتصال مباشر عشوائي.

المرحلة التالية ليست تطوير UI كبير، بل تشغيل مضبوط على staging/production:

- تطبيق migrations
- ربط Meta
- اختبار عميل واحد
- مراقبة قرارات الوكيل
- رفع الثقة تدريجياً
