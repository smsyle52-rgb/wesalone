# وصال ون — Wesal One

منصة B2B تُعطي التاجر العربي وكيل مبيعات ذكياً يردّ على عملائه ويُنجز مهمات (طلبات، متابعات، تصعيد) عبر قنوات Meta — واتساب، إنستغرام، ماسنجر.

---

## البنية العامة

```
monorepo (pnpm workspaces)
├── artifacts/
│   ├── api-server/     ← الخادم الرئيسي (Express 5, Node 22)
│   ├── outbox-worker/  ← worker منفصل (إرسال + تشغيل الوكيل)
│   └── web/            ← لوحة التحكم (React 19 + Vite)
├── packages/
│   └── db/             ← Drizzle ORM + schema مشترك
└── scripts/            ← سكربتات تشغيلية (enable:phase2-tools …)
```

### api-server
خادم HTTP يستقبل webhooks من Meta، يخدم API للواجهة، يبثّ أحداث SSE للوارد الحي، ويستدعي الـAI لتوليد الردود.

### outbox-worker
عملية مستقلة تعمل في Cloud Run منفصلاً:
- كل **3 ثوانٍ**: يسحب `outbox_events` المعلّقة ويرسلها لـMeta Graph API (واتساب / إنستغرام / ماسنجر).
- كل **5 ثوانٍ**: يسحب `domain_events` (نوع `message.received`) ويستدعي `/internal/agent-reply` في api-server لتشغيل الوكيل.

الفرق الجوهري: **api-server يستقبل ويقرر، outbox-worker يُرسل وينفّذ.**

---

## التشغيل المحلي

```bash
# المتطلبات: Node 22, pnpm (عبر corepack)
corepack enable

# تثبيت الاعتماديات
corepack pnpm install

# typecheck كامل
corepack pnpm run typecheck

# بناء كامل (بدون mockup-sandbox)
corepack pnpm run build:prod

# تشغيل api-server
corepack pnpm --filter @workspace/api-server run dev

# تشغيل outbox-worker (نافذة منفصلة)
corepack pnpm --filter @workspace/outbox-worker run dev
```

متغيرات البيئة المطلوبة: انظر **الأسرار** أدناه.

---

## البناء والنشر

كل `push` على `main` يُطلق Cloud Build triggers تلقائياً:

| Trigger | الملف | الخدمة |
|---|---|---|
| `khadamatak-staging` | `cloudbuild.yaml` | api-server + web |
| `khadamatak-worker` | `cloudbuild.worker.yaml` | outbox-worker |

النشر يستغرق ~3-4 دقائق. **لا تحتاج push يدوي للصور.**

---

## الأسرار وإعداد البيئة

جميع الأسرار في **GCP Secret Manager** وتُحقن وقت النشر عبر Cloud Build.
لا يوجد سر في الكود أو git history.

| المتغير | الوصف | مطلوب |
|---|---|---|
| `DATABASE_URL` | PostgreSQL (Cloud SQL) connection string | ✅ |
| `SESSION_SECRET` | توقيع كوكيز الجلسة (≥32 حرف في الإنتاج) | ✅ |
| `INTERNAL_SECRET` | يحمي `/internal/*` بين api-server وworker | ✅ في الإنتاج |
| `META_SYSTEM_USER_TOKEN` | توكن واتساب (Tech Provider) | ✅ |
| `META_WEBHOOK_SECRET` أو `META_APP_SECRET` | سر توقيع HMAC للـwebhook | ✅ |
| `META_WEBHOOK_VERIFY_TOKEN` | رمز التحقق عند تسجيل الـwebhook | ✅ |
| `META_OAUTH_STATE_SECRET` أو `SESSION_SECRET` | مفتاح فك تشفير توكنات IG/Messenger | ✅ |
| `GEMINI_API_KEY` | Gemini AI (اختياري — بديل Vertex) | اختياري |
| `ALLOWED_ORIGINS` | قائمة origins مسموح بها لـCORS (فاصلة) | اختياري |
| `EMBEDDINGS_DRY_RUN` | `false` في الإنتاج لتفعيل المتجهات الحقيقية | `false` |

للتطوير المحلي: انسخ `.env.example` (إن وُجد) أو أنشئ `.env` في جذر المشروع. الملف مُستثنى من git.

---

## قنوات Meta

| القناة | النموذج | الحالة |
|---|---|---|
| واتساب | Tech Provider (توكن مشترك `META_SYSTEM_USER_TOKEN`) | ✅ حي |
| إنستغرام | page token مشفّر AES-256-GCM لكل حساب | ✅ حي |
| ماسنجر | page token مشفّر AES-256-GCM لكل صفحة | ✅ حي |

ربط IG/Messenger: `POST /api/integrations/meta/embedded-signup/instagram/complete` و`/messenger/complete`.

---

## الـAI

الأولوية: **Vertex AI → Gemini → mock** (يُحدَّد عند الإقلاع).
عند غياب AI الحقيقي: الوكيل يُصعّد للبشر بصمت — لا يصل نص تجريبي للعميل.

---

## قاعدة البيانات

PostgreSQL (Cloud SQL). المخطط والهجرات في `packages/db/`.
نموذج متعدد العملاء (Pool): بنية مشتركة + عزل منطقي بعمود `workspace_id` على كل استعلام.

---

## ملفات مرجعية

| الملف | الوصف |
|---|---|
| `WESAL_ONE_CHAT_HANDOFF.md` | الحالة الحيّة — النطاقات المُغلقة والمعلّقة |
| `.claude/skills/wesal-one-agents/references/launch-readiness-plan.md` | خطة جاهزية الإطلاق الكاملة |
| `DEPLOYMENT_STAGING.md` | تفاصيل إعداد Cloud Run |
