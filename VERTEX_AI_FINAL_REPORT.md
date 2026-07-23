# التقرير النهائي — ربط Vertex AI كمزوّد المنصة الداخلي

**المشروع:** ChatbotX (نسخة العمل المعزولة)  
**مجلد العمل الوحيد:** `C:\Users\USERW\Documents\ChatbotX-main-commerce-ui-wt`  
**مجلد محظور التعديل:** `C:\Users\USERW\Documents\ChatbotX-main`  
**مرجع وصال ون (قراءة فقط):** `C:\Users\USERW\Documents\khadamatak-github-publish-20260507163016`  
**تاريخ التقرير:** 2026-07-17  
**حالة النشر:** غير منشور — لا commit ولا push ولا deploy  
**حالة التفعيل:** `enabled = false` افتراضيًا — لا اتصال حي بـ Vertex

---

## 0) ملخص تنفيذي

تم تنفيذ ربط **Vertex AI** كمزوّد داخلي ثابت للمنصة داخل ChatbotX، مع:

- إعداد مركزي في قاعدة البيانات (بدون أسرار).
- مصادقة عبر **Application Default Credentials (ADC)** فقط.
- وراثة وقت التشغيل لكل مسارات الرد الآلي للوكلاء عند التفعيل.
- لوحة مشرف المنصة تحت `/admin/ai-settings` لتغيير الموديل الرئيسي وتفعيل/تعطيل الإعداد.
- اختبارات وحدة/عزل مستهدفة + فحص أنواع (check-types) + lint على الملفات المتأثرة.

**ما لم يُنفَّذ عمدًا أو ما بقي موقوفًا:**

1. ربط embeddings الخاصة بقاعدة المعرفة فعليًا (تعارض أبعاد المتجهات).
2. إخفاء واجهة اختيار المزوّد/الموديل عن العملاء في شاشات الوكلاء (الفرض يتم وقت التشغيل فقط).
3. أي تكامل صوتي (STT/TTS) — تقرير فقط.
4. تطبيق migration على أي قاعدة بيانات.
5. أي اتصال مدفوع/حي بـ Vertex.
6. build كامل للإنتاج في جولة التحقق الأخيرة (الأنواع على builder/worker نجحت).

---

## 1) خريطة النظام قبل التعديل وبعده

### 1.1 قبل التعديل

| المكوّن | السلوك |
|--------|--------|
| مزوّدو AI | BYOK لكل مساحة عمل: OpenAI، Claude، Gemini (Developer API)، DeepSeek، OpenRouter، OpenAI-compatible |
| اختيار الموديل | يُخزَّن على الوكيل (`AIAgent.models`) ويُنفَّذ كما هو في الـ worker |
| المنصة | لا يوجد إعداد مركزي يفرض مزوّدًا داخليًا على كل الوكلاء |
| المعرفة (RAG) | embeddings عبر مسارات المزوّدين الحاليين؛ أعمدة `vector(1536)` |
| الصوت | خطوات Flow فقط عبر OpenAI (Whisper / TTS) |

### 1.2 بعد التعديل

| المكوّن | السلوك |
|--------|--------|
| مزوّد المنصة | ثابت: **Vertex AI** (مخفي عن العملاء كمزوّد اختياري) |
| جدول الإعداد | `PlatformAiSetting` — صف singleton لكل `provider` (اليوم: `vertex` فقط) |
| التفعيل | `enabled=false` افتراضيًا → السلوك القديم كاملًا |
| عند التفعيل + وجود `VERTEX_AI_PROJECT_ID` | كل مسارات الرد الآلي ترث `chatModel` (واختياريًا `fallbackModel`) من إعداد المنصة |
| عند غياب project env رغم التفعيل | فشل مغلق (fail-closed): يُتجاهل الـ override ويُعاد السلوك القديم مع تحذير في السجل |
| Admin | `/admin/ai-settings` — super admin فقط |
| المعرفة | مصنع embedding لـ Vertex موجود كقدرة فقط — **غير موصول** بمسار RAG الحي |
| الأسرار | لا تُحفظ مفاتيح Google ولا JSON service account في قاعدة البيانات |

---

## 2) الملفات الجديدة والمعدَّلة

### 2.1 قاعدة البيانات (`packages/database`)

| ملف | نوع |
|-----|-----|
| `src/partials/platform-ai-setting.ts` | جديد |
| `src/schema/platform-ai-setting.ts` | جديد |
| `src/relations/platform-ai-setting.ts` | جديد |
| `src/partials/index.ts` | تسجيل |
| `src/schema/index.ts` | تسجيل |
| `src/relations/index.ts` | تسجيل |
| `src/types.ts` | تسجيل الأنواع |
| `drizzle/20260717193734_add_platform_ai_setting/migration.sql` | migration مولَّدة فقط |
| `drizzle/20260717193734_add_platform_ai_setting/snapshot.json` | لقطة Drizzle |

### 2.2 طبقة الأعمال (`packages/business`)

| ملف | نوع |
|-----|-----|
| `src/platform-ai-setting/service.ts` | جديد — get / getActive / upsert / cache |
| `src/platform-ai-setting/index.ts` | جديد — تصدير عام |
| `src/index.ts` | تسجيل التصدير |
| `__tests__/platform-ai-setting.service.test.ts` | اختبارات |

### 2.3 طبقة AI (`packages/ai`)

| ملف | نوع |
|-----|-----|
| `src/models/vertex.ts` | جديد — allowlist للموديلات وembeddings |
| `src/models/index.ts` | تصدير |
| `src/server/platform-provider.ts` | جديد — override + Vertex factory + ADC |
| `src/server/index.ts` | تصدير |
| `src/keys.ts` | `VERTEX_AI_PROJECT_ID` / `VERTEX_AI_LOCATION` (اختياريان) |
| `package.json` | اعتماد `@ai-sdk/google-vertex@4.0.164` |
| `__tests__/platform-provider.test.ts` | اختبارات |

### 2.4 الـ Worker (`apps/worker`)

| ملف | نوع |
|-----|-----|
| `src/integration/handlers/shared/ai-agent-runner.ts` | حقن الـ override (DM + خطوة وكيل في الـ flow) |
| `src/integration/handlers/automated-response/replies.ts` | حقن الـ override (ردود التعليقات / generateAIReplyText) |
| `__tests__/ai-agent-runner-platform-override.test.ts` | اختبارات |
| `__tests__/automated-response-platform-override.test.ts` | اختبارات |

### 2.5 واجهة المشرف (`apps/builder`)

| ملف | نوع |
|-----|-----|
| `src/features/platform-ai/schema.ts` | جديد |
| `src/features/platform-ai/update-platform-ai-settings.action.ts` | جديد — `superAdminActionClient` |
| `src/features/platform-ai/validate-platform-ai-settings.action.ts` | جديد — تحقق إعداد فقط (بدون نداء شبكة) |
| `src/features/platform-ai/platform-ai-settings.tsx` | جديد — مكوّن الواجهة |
| `src/app/admin/ai-settings/page.tsx` | جديد — الصفحة |
| `src/features/admin/components/admin-sidebar.tsx` | رابط القائمة |
| `messages/en.json` | مفاتيح i18n |
| `messages/ar.json` | مفاتيح i18n |

### 2.6 ما لم يُمس (تأكيد نطاق)

- قنوات Meta / WhatsApp / Instagram / Messenger / Telegram وWebhooks.
- Google OAuth.
- الطلبات والمخزون والدفع التجاري واشتراكات المنصة اليدوية السابقة.
- prompts / tools / handoff / قرار الوكيل.
- مجلد `ChatbotX-main` الأصلي.
- Cloud Run / Secret Manager / بيانات اعتماد الإنتاج.

---

## 3) أين يُحفظ إعداد المنصة

### 3.1 الجدول

**الاسم:** `PlatformAiSetting`

| العمود | المعنى |
|--------|--------|
| `provider` | ثابت منطقيًا: `vertex` (enum `platformAiProvider`) |
| `chatModel` | الموديل الرئيسي (افتراضي: `gemini-3.1-flash-lite`) |
| `embeddingModel` | موديل التضمين (افتراضي: `text-embedding-005`) — مخزَّن للعرض/المستقبل |
| `location` | المنطقة الافتراضية في الصف: `us-central1` (يمكن تجاوزها بـ env) |
| `fallbackModel` | موديل احتياطي اختياري داخل Vertex |
| `enabled` | `false` افتراضيًا |
| `updatedByUserId` | آخر مشرف عدّل الإعداد |

**قيود:** فهرس فريد على `provider` → صف واحد لكل مزوّد.

### 3.2 ما لا يُحفظ أبدًا

- مفاتيح API.
- JSON Service Account.
- Project ID داخل الجدول (Project ID من البيئة فقط: `VERTEX_AI_PROJECT_ID`).
- أي token.

### 3.3 القيم الافتراضية المعتمدة

| المفتاح | القيمة |
|---------|--------|
| provider | `vertex` |
| chatModel | `gemini-3.1-flash-lite` |
| embeddingModel | `text-embedding-005` |
| location | `us-central1` |
| enabled | `false` |
| Google Cloud Project (env) | المتوقع تشغيليًا: `khadamatk-auth` — **لا يُ thrد كودًا** |

---

## 4) كيف يرث الوكلاء الموديل دون تغيير منطقهم

### 4.1 نقطة القرار الوحيدة

الدالة: `getActivePlatformAiOverride()` في  
`packages/ai/src/server/platform-provider.ts`

تعيد `null` إذا:

- الإعداد معطّل، أو
- لا يوجد صف مفعّل، أو
- `VERTEX_AI_PROJECT_ID` غير مضبوط.

وتعيد كائن override إذا كان الإعداد مفعّلًا والبيئة جاهزة.

### 4.2 حقن وقت التشغيل (جراحي)

في:

1. `apps/worker/src/integration/handlers/shared/ai-agent-runner.ts`
2. `apps/worker/src/integration/handlers/automated-response/replies.ts`

عند وجود override:

```text
providersToRun = buildPlatformOverrideCandidates(override)
```

بدلًا من قراءة `aiAgent.models` أو `preferredModel` / `preferredProvider`.

المرشّحون من نوع داخلي في الذاكرة فقط:

```text
{ platformVertex: true, model: "<chatModel>" }
(+ fallback اختياري)
```

**لا يُوسَّع** مخطط `AIAgentModelConfig` المخزَّن في قاعدة البيانات.  
**لا تُحذف** إعدادات الوكيل القديمة — تبقى للرجوع عند التعطيل.

### 4.3 ما لا يتغيّر

- system prompts
- tools / MCP / file search
- handoff للحارس البشري
- منطق اختيار الأدوات أو مسار التنفيذ بعد اختيار الموديل

---

## 5) كيف تعمل مصادقة ADC

### 5.1 الإنشاء

```ts
createVertex({
  project: override.projectId,  // من VERTEX_AI_PROJECT_ID
  location: override.location,  // env يتقدّم على قيمة الصف إن وُجد
})
// بدون apiKey → مسار ADC عبر google-auth-library
```

### 5.2 سلسلة الاعتماد المتوقعة

1. **الإنتاج (Cloud Run):** هوية Service Account المرتبطة بالخدمة.
2. **التطوير المحلي (إن لزم لاحقًا):** `gcloud auth application-default login` أو متغيّرات ADC القياسية.
3. **ممنوع:** تخزين مفتاح Gemini API أو JSON في DB أو في إعداد المنصة.

### 5.3 متغيّرات البيئة

| المتغيّر | إلزامي للتفعيل الفعلي | ملاحظات |
|----------|------------------------|---------|
| `VERTEX_AI_PROJECT_ID` | نعم (وإلا fail-closed) | لا قيمة افتراضية في الكود |
| `VERTEX_AI_LOCATION` | لا | إن وُجد يتجاوز `location` المخزَّن |

### 5.4 تحقق المشرف (بدون شبكة)

`validatePlatformAiSettingsAction`:

- يتحقق من وجود `VERTEX_AI_PROJECT_ID` (وجود فقط، **لا يعيد قيمة الـ project**).
- يعيد الموديلات المحلولة وحالة ok/issues.
- **لا** ينادي Vertex ولا يستهلك حصة.

---

## 6) قاعدة المعرفة وVertex embeddings

### 6.1 الوضع الحالي في المخطط

| الجدول | بُعد المتجه |
|--------|-------------|
| `AIEmbedding.embedding` | `vector(1536)` |
| `AIConversationEmbedding.embedding` | `vector(1536)` |

### 6.2 موديل Vertex الافتراضي

`text-embedding-005` → أبعاد شائعة **768** (وليست 1536).

### 6.3 القرار المنفَّذ

- وُجدت القدرة: `getPlatformVertexEmbeddingModel(...)`.
- **لم تُوصَل** إلى `resolveEmbeddingModel` / مسار knowledge-base الحي.
- **لم تُغيَّر** أبعاد pgvector.
- **لم تُنشأ** migration أبعاد.

### 6.4 لماذا التوقّف هنا صحيح

ربط `text-embedding-005` مباشرةً على أعمدة `vector(1536)` سيؤدي إما إلى:

- فشل عند الإدراج، أو
- فساد تشابه المتجهات إن أُجبر التحويل بشكل خاطئ، أو
- الحاجة لـ migration خطرة + إعادة توليد كل embeddings + خطة عزل مساحات العمل.

**التوصية للجولة القادمة (قرار منتج/بنية، ليس تنفيذًا الآن):**

1. إثبات أبعاد الموديل المختار رسميًا.
2. إن لزم 768: migration أبعاد + إعادة فهرسة + backfill لكل workspace.
3. أو اختيار موديل embedding متوافق مع 1536 إن وُجد ومُعتمد.
4. فقط بعدها ربط `resolveEmbeddingModel` مع الحفاظ على عزل `workspaceId`.

---

## 7) الـ Migration المقترحة (غير مطبَّقة)

**المسار:**

`packages/database/drizzle/20260717193734_add_platform_ai_setting/`

**محتوى SQL (ملخّص):**

- إنشاء enum `platformAiProvider` بقيمة `vertex`.
- إنشاء جدول `PlatformAiSetting` بالأعمدة أعلاه.
- فهرس فريد على `provider`.
- FK اختياري `updatedByUserId` → `User(id)` مع `ON DELETE SET NULL`.
- `enabled` افتراضيًا `false`.

**ما لم يحدث:**

- لا `db:migrate`
- لا تطبيق على staging/production/local DB في هذه الجولة

---

## 8) نتائج الاختبارات وcheck-types وlint

### 8.1 check-types

| الحزمة / التطبيق | النتيجة |
|------------------|---------|
| `@chatbotx.io/database` | ناجح |
| `@chatbotx.io/business` | ناجح |
| `@chatbotx.io/ai` | ناجح |
| `worker` + اعتماداته عبر turbo | ناجح |
| `builder` + اعتماداته عبر turbo | ناجح |
| ملخّص turbo (filter worker+builder) | **47/47 successful** |

### 8.2 الاختبارات الجديدة المستهدفة

| الملف | العدد | النتيجة |
|-------|-------|---------|
| `packages/business/__tests__/platform-ai-setting.service.test.ts` | 9 | ناجح |
| `packages/ai/__tests__/platform-provider.test.ts` | 11 | ناجح |
| `apps/worker/__tests__/ai-agent-runner-platform-override.test.ts` | 5 | ناجح |
| `apps/worker/__tests__/automated-response-platform-override.test.ts` | 2 | ناجح |
| **المجموع** | **27** | **كلها ناجحة** |

**ما تغطيه تقريبًا:**

- المزوّد المركزي ثابت Vertex.
- التعطيل يعيد `null` (سلوك أصلي).
- غياب `VERTEX_AI_PROJECT_ID` يفشل مغلقًا.
- الموديل الافتراضي `gemini-3.1-flash-lite` ضمن المسارات المختبرة.
- مرشّحو الـ override لا يختلطون مع إعداد BYOK المخزَّن.
- مسارات worker تحترم الـ override عند التفعيل.

**ملاحظة stderr أثناء بعض اختبارات worker:** رسائل `ECONNREFUSED 127.0.0.1:1` من بيئة mock/شبكة وهمية؛ **لم تفشل** حالات الاختبار.

### 8.3 lint

- فحص Biome على الملفات المتأثرة: **نظيف** بعد إصلاحات تنسيق بسيطة (لا تغيير سلوكي).

### 8.4 build

- لم يُشغَّل build إنتاج كامل في جولة التحقق النهائية هذه.
- نجاح `check-types` على `builder` و`worker` يقلّل مخاطر كسر الأنواع في المسارات المعدَّلة.
- يُنصح بتشغيل build كامل قبل أي نشر مستقبلي.

### 8.5 ما لم يُختبَر عمدًا

- نداء Vertex حقيقي / مدفوع.
- تطبيق migration على DB حقيقية.
- واجهة العميل الحية end-to-end في متصفح.

---

## 9) خطة الصوتيات فقط (بدون تنفيذ)

### 9.1 ما يعمل اليوم

| القدرة | التنفيذ الحالي |
|--------|----------------|
| Speech-to-Text | خطوة Flow: `aiSpeechToText` — مزوّد `openai` — موديل `whisper-1` |
| Text-to-Speech | خطوة Flow: `aiTextToSpeech` — نماذج مثل `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd` |
| النطاق | **خطوات Flow فقط** — ليست تفريغًا تلقائيًا لكل رسائل القنوات |

**ملفات مرجعية (قائمة غير حصرية):**

- `packages/flow-config/src/steps/ai-speech-to-text.ts`
- `packages/flow-config/src/steps/ai-text-to-speech.ts`
- `apps/worker/src/integration/handlers/text-to-speech/`
- نماذج OpenAI ذات الصلة في `packages/ai/src/models/openai.ts`

### 9.2 أقل تكامل لاحق لـ Google Cloud STT/TTS

1. إضافة مزوّد Google في مخططات خطوات الصوت (منفصل عن Vertex chat إن لزم).
2. Handlers في الـ worker تستدعي Google Cloud Speech-to-Text وText-to-Speech عبر ADC.
3. تحديث UI خطوات الـ flow في builder + i18n.
4. اختبارات عزل: لا تسرّب credentials، وفشل واضح بدون mock صامت في production.

### 9.3 ملفات يُتوقع تأثرها لاحقًا

- `packages/flow-config/src/steps/ai-speech-to-text.ts`
- `packages/flow-config/src/steps/ai-text-to-speech.ts`
- handlers تحت `apps/worker/src/integration/handlers/`
- واجهات اختيار الخطوة في builder
- ملفات الترجمة

**هذه الجولة: لا كود صوت.**

---

## 10) تأكيد عدم لمس Meta والقنوات وOAuth والتجارة

| المجال | الحالة |
|--------|--------|
| Meta / صلاحيات / Webhooks | لم تُلمس |
| WhatsApp / Instagram / Messenger / Telegram | لم تُلمس |
| Google OAuth | لم يُلمس |
| الطلبات / المخزون | لم تُلمس |
| الدفع اليدوي لاشتراكات المنصة (الجولة السابقة) | لم تُعدَّل في هذه المهمة |
| Cloud Run / Secret Manager | لم يُغيَّرا |
| `ChatbotX-main` | لم يُعدَّل |

---

## 11) تأكيد عدم تنفيذ migration أو deploy أو اتصال Vertex حقيقي

| العملية | الحالة |
|---------|--------|
| توليد migration | نعم (ملف فقط) |
| تطبيق migration | **لا** |
| commit | **لا** |
| push | **لا** |
| deploy | **لا** |
| اتصال Vertex حي/مدفوع | **لا** |
| تفعيل الإعداد في DB | **لا** (`enabled` افتراضي false) |

---

## 12) لوحة المشرف — السلوك الأمني

| البند | التنفيذ |
|-------|---------|
| المسار | `/admin/ai-settings` |
| الصلاحية | `superAdminActionClient` + حماية layout الـ admin |
| المزوّد في الواجهة | Vertex AI — للقراءة فقط |
| قابل للتعديل | chat model (allowlist) + fallback + enabled |
| embedding | معروض للقراءة |
| Project ID للعملاء | غير معروض |
| اختبار الإعداد | وجود env فقط — بلا أسرار في الاستجابة |
| أصحاب المساحات | لا مسار لتعديل هذا الإعداد |

---

## 13) الفجوات المتبقية (للجولة القادمة)

| # | الفجوة | الأثر | الأولوية المقترحة |
|---|--------|-------|-------------------|
| 1 | إخفاء UI اختيار المزوّد/الموديل في `ai-agents` عند تفعيل Vertex | وقت التشغيل يفرض Vertex، لكن الواجهة ما زالت تعرض الاختيار | متوسطة |
| 2 | ربط embeddings بعد حل أبعاد 768 vs 1536 | المعرفة لا تستخدم Vertex بعد | عالية قبل تفعيل المعرفة |
| 3 | اختبار isolation مصدري لـ actions المشرف (نمط subscription-payment) | تغطية إضافية لحدود الصلاحيات | منخفضة–متوسطة |
| 4 | build إنتاج كامل | ثقة نشر أعلى | قبل أي deploy |
| 5 | تطبيق migration + ضبط env + تفعيل يدوي | التشغيل الفعلي | بعد مراجعة وموافقة |

---

## 14) خطوات التفعيل الآمن لاحقًا (ليست منفَّذة الآن)

1. مراجعة هذا التقرير والكود.
2. أخذ نسخة احتياطية من قاعدة البيانات المستهدفة.
3. تطبيق migration: `20260717193734_add_platform_ai_setting` فقط.
4. ضبط على بيئة التشغيل:
   - `VERTEX_AI_PROJECT_ID=khadamatk-auth` (أو القيمة المعتمدة)
   - `VERTEX_AI_LOCATION=us-central1` اختياريًا
5. التأكد من صلاحيات Service Account على Vertex AI.
6. من `/admin/ai-settings`: اختيار الموديل ثم تفعيل `enabled`.
7. تشغيل «تحقق الإعداد» (وجود project فقط).
8. اختبار رد وكيل واحد في بيئة غير إنتاجية أولًا.
9. **عدم** ربط المعرفة حتى يُحسم ملف الأبعاد.

---

## 15) الخلاصة النهائية

تم إنجاز **الطبقة الأساسية** لربط Vertex AI كمزوّد منصة داخلي في مجلد العمل المعزول:

- إعداد مركزي آمن بلا أسرار.
- ADC فقط.
- وراثة وقت التشغيل للوكلاء مع الحفاظ على بياناتهم القديمة.
- لوحة مشرف.
- migration مولَّدة وغير مطبَّقة.
- **27 اختبارًا ناجحًا** + **check-types نظيف** + **lint نظيف** على النطاق المتأثر.
- النظام **غير مفعّل** و**غير منشور**.

**جاهز للمراجعة البشرية.**  
أي تفعيل أو نشر أو migration أو ربط معرفة يتطلب قرارًا صريحًا لاحقًا.

---

*نهاية التقرير.*
