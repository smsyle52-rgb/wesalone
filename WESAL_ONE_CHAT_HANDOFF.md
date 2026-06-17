# WESAL ONE — الحالة الحيّة
آخر تحديث: 17 يونيو 2026

---

## الحالة الإجمالية

**✅ PD-7 مُصلَح** (مدفوع `9cbf5a7`). **✅ PD-8 مُصلَح** (مدفوع `a3cb4a6`، parser ثلاثي الطبقات — مُثبَت بالاختبار الحيّ). **✅ PD-9 مُصلَح بالكود** (`a3cb4a6` → `coerceCurrency` + `z.preprocess` + تحديث الـprompt — typecheck نظيف) — **ينتظر push ومن ثم اختبار حيّ**.

---

## 🔴 Hotfix PD-9 — `create_order` تفشل على كل محادثة عربية (17 يونيو 2026)

**العَرَض:** المالك أرسل "كرتونين مياه... ريال يمني" — الوكيل ردّ "أحتاج أن أحوّل طلبك للفريق". الاختبار الثاني (رقم آخر، بلا سعر) استدعى `handoff_to_human` لغياب السعر (سلوك آمن، ليس عطلاً).

**التشخيص (من DB):** `Agent tool failed: create_order - Invalid enum value. Expected 'YER'|'SAR'|'USD', received 'ريال يمني'` — في موضعَين (`currency` الجذر + `items[0].currency`). النموذج يمرّر ما قاله العميل حرفياً بدل رمز ISO. الـprompt لم يذكر الرموز. `createOrderSchema.parse()` يرمي → `hasToolProblem=true` → جملة التحويل → لا طلب يُنشأ.

**الإصلاح (`agent-tools.ts`):**
1. `coerceCurrency()`: يمني→`YER`، سعودي→`SAR`، دولار→`USD`؛ مجهول يبقى كما هو (Zod يطبّق default).
2. `z.preprocess` على جميع حقول currency + الأرقام (`quantity`, `unitPrice`, `discount`).
3. الـprompt: يذكر `(YER/SAR/USD, e.g. YER for ريال يمني)` صراحةً.

**typecheck:** api-server ✅

**اختبار الإغلاق:** أرسل "أطلب كرتونين مياه بـ2000 ريال يمني الدفع عند الاستلام" → يجب أن يصل ردّ نظيف + ينزل صفّ في `orders` (نتحقق بالاستعلام).

---

## ✅ Hotfix PD-8 — JSON خام يصل للعميل + استدعاءات أدوات ضائعة (16–17 يونيو 2026)

**العَرَض:** أثناء اختبار `create_order` حيّاً، وصل العميل `{"reply":"..."}` خاماً بدل النص، و`create_order` لم يُستدعَ.

**الجذر:** النموذج يضع أسطراً حقيقية داخل قيمة `reply` متعددة الفقرات → `JSON.parse` يفشل → `parseAgentToolResponse` كان يُرجع المحتوى الخام. **الأخطر:** نفس الفشل يُسقط `tool_calls` → أي ردّ متعدد الأسطر بأداة لا تُنفَّذ أداته أبداً.

**الإصلاح (`agent-tools.ts`):** تحليل متين 3 طبقات — parse مباشر → تهريب أحرف التحكّم داخل السلاسل فقط → استخراج reply بـregex (آخر دفاع). **مُثبَت محلياً** على المُدخل الفاشل الحقيقي (نص نظيف + tool_calls سليمة + لا انحدار).

**typecheck + build:** api-server ✅

**متبقٍّ للـstaging:**
```
artifacts/api-server/src/lib/agent-tools.ts
.claude/skills/wesal-one-agents/references/launch-readiness-plan.md
.codex/skills/wesal-one-agents/references/launch-readiness-plan.md
WESAL_ONE_CHAT_HANDOFF.md
```

---

## 🔴 Hotfix PD-7 — الوكيل توقّف عن الرد كلياً (16 يونيو 2026)

**العَرَض:** المالك أبلغ "الوكيل وقف لا يرد". `/api/readyz=ok`، المحادثة `active`، الوكيل `active`، القناة `active` — كل الشروط سليمة ومع ذلك لا رد.

**الجذر (مؤكَّد من قاعدة الإنتاج + سجلّات Cloud Run):** `messages.sender_id` مرتبط بـFK على `users.id`. إصلاح PD-2 (commit `19fc66e`، 15 يونيو 18:01 UTC) أدرج رسالة الوكيل بـ`senderId=معرّف الوكيل` (من `ai_agents`) → كل إدراج يكسر القيد `messages_sender_id_users_id_fk` → الـendpoint يرمي 500 → الـdomain_event `failed` → **الرد يُولَّد (ai_run=succeeded) لكن يُرمى، العميل لا يصله شيء**. ارتباط زمني قاطع: آخر نجاح 17:45 UTC، أول فشل 21:06 UTC (أول وارد بعد نشر `19fc66e`). **من commit المالك، ليس Cursor.**

| الطبقة | الإصلاح | الملف |
|---|---|---|
| 1 — الجذر | `senderId: null` + `senderName: agent.name` (نفس نمط `agent-tools.ts` الصحيح) | `internal.routes.ts` |
| 2 — دفاع عميق (محمية #10) | فشل الحفظ/الإدراج → تصعيد للبشر + `notifyWorkspace` + إبلاغ الـworker بالتصعيد (`done` لا `failed`) بدل إسقاط صامت متكرّر | `internal.routes.ts` |
| 4 — حارس انحدار | تعليق حاكم: رسائل الوكيل/النظام senderId=null دائماً | `internal.routes.ts` |
| 5 — توثيق | تشريح PD-7 كامل + تصحيح سجلّ النطاق 5 | `launch-readiness-plan.md` |

**استرداد (الطبقة 3 — بعد النشر):** الأحداث الـ11 الفاشلة تُعاد لـ`pending` ليعيد الـworker معالجتها (منطق 24س يرسل الطازج ويصعّد المنتهي). **يُنفَّذ بعد أن تصبح النسخة الجديدة حيّة فقط.**

**typecheck + build:** api-server ✅

**متبقٍّ للـstaging:**
```
artifacts/api-server/src/routes/internal.routes.ts
.claude/skills/wesal-one-agents/references/launch-readiness-plan.md
.codex/skills/wesal-one-agents/references/launch-readiness-plan.md
WESAL_ONE_CHAT_HANDOFF.md
```

**الدرس الحاكم:** "مُغلق بالكود" ≠ "يعمل في الإنتاج". النطاق 5 كان ✅ بينما الوكيل ميّت فعلياً ~20 ساعة. بوابة الإغلاق تتطلب **اختباراً حيّاً** (رسالة واردة حقيقية → رد يصل)، لا typecheck/build فقط.

---

## Hotfix H8-3 — إصلاح "الوكيل صمت" + رسائل لا تظهر (16 يونيو 2026)

بعد دفعات Cursor الثلاث (`d4c5b2e`, `b26da1c`, `baffd53`) ظهرت أعطال جديدة. الفحص كشف:

| الرمز | العطل | الإصلاح | الملف |
|---|---|---|---|
| H8-3a | فشل الأداة لا يُصعّد بعد الآن → الوكيل يكرر وعد "سأحوّل لفريق" بلا تحويل فعلي | أعدت `hasToolProblem` لشرط `shouldEscalate` | `agent-reply.ts` |
| H8-3b | رد `/internal/agent-reply` يكتب `shouldEscalate: false` دائماً (قيمة ثابتة خطأ) + لا تنبيه للفريق عند أي تصعيد | القيمة الحقيقية + `notifyWorkspace` على كل تصعيد | `internal.routes.ts` |
| H8-3c | **خطر**: الـworker كان يعيد تفعيل الوكيل تلقائياً بعد ساعتين من أي محادثة مُصعَّدة للبشر بصمت — يخالف قاعدة "لا قرار حسّاس بلا إنسان" | حذف إعادة التفعيل التلقائي بالكامل — التصعيد للبشر يبقى ساري حتى يتدخّل أحد | `outbox-worker/index.ts` |
| H8-3d | `api-server` بلا `max-instances` على Cloud Run؛ الـrealtime (SSE) في الذاكرة فقط → لو شغّلت نسخ متعددة، تأخير عرض الرسائل (polling كل 5-10s يخفّف الأثر لكن لا يلغيه) | `--min-instances=1 --max-instances=1` (يطابق الـworker) | `cloudbuild.yaml` |
| H8-3e | الرسائل اليدوية الصادرة (ردّ موظف) لا تبثّ SSE — موظف آخر بتبويب آخر ينتظر الـpolling فقط | `emitWorkspaceEvent` لكل رسالة صادرة | `conversations.routes.ts` |

**typecheck + build:** api-server ✅ outbox-worker ✅

**متبقٍّ للـstaging:**
```
artifacts/api-server/src/lib/agent-reply.ts
artifacts/api-server/src/routes/internal.routes.ts
artifacts/api-server/src/modules/conversations/conversations.routes.ts
artifacts/outbox-worker/src/index.ts
cloudbuild.yaml
WESAL_ONE_CHAT_HANDOFF.md
```

⚠️ **تنبيه مهم:** آخر 3 commits (`d4c5b2e`, `b26da1c`, `baffd53`) جاءت من Cursor مباشرة على `main` بدون مراجعة هنا. يُنصح بمراجعة أي عمل مستقبلي من Cursor في هذا المستودع قبل الدفع، خصوصاً للقرارات التي تخصّ سلوك التصعيد البشري/الأمان.

---

## جدول النطاقات

| النطاق | العنوان | الحالة | Commits |
|---|---|---|---|
| **النطاق 1** | المصادقة والجلسات | ✅ مُغلق | `4123883` |
| **النطاق 2** | عزل العملاء | ✅ مُغلق | `4f804e4` |
| **النطاق 3** | الأسرار والاعتمادات | ✅ مُغلق | `739cca0` |
| **النطاق 4** | متانة القنوات | ✅ مُغلق | `3388ab9` |
| **النطاق 5** | وقت تشغيل الوكيل | ✅ كود — ⏳ اختبار حيّ بعد PD-7 | `ff49ebe` `ce93b59` `c3d9d61` + PD-7 |
| **النطاق 6** | الموثوقية والتشغيل | ✅ مُغلق (R6-6 يدوي) | `86fa6cb` |
| **النطاق 7** | قاعدة المعرفة والاسترجاع | ✅ مُغلق | `86fa6cb` |
| **النطاق 8** | الوسائط (PD-3) | 🔍 قيد التحقق | `86fa6cb` |
| **النطاق 9** | الأتمتة والمتابعة والبث | ✅ مُغلق (الأتمتة مؤجّلة بقرار) | — |

---

## النطاق 5 — التفصيل

### مُغلق ✅
| الرمز | الإصلاح | Commit |
|---|---|---|
| H5-1 | تصعيد صامت عند غياب AI — لا يصل نص تجريبي للعميل | (سابق) |
| Q5-4 | idempotency عبر `domainEventId` — يمنع رد مكرر عند إعادة معالجة domain_event | `ff49ebe` |
| M5-2 | توحيد `SAFETY_SYSTEM_PROMPT` مع السلوك الفعلي — حُذف «أنت تقترح فقط» | `ce93b59` |
| Q5-1 | ربط المحرك الهجين (TSV + vector) بالوكيل الحي — بديل ILIKE البسيط | `c3d9d61` |

### مكتمل ✅
| الرمز | المطلوب | الحالة |
|---|---|---|
| Q5-2 | `EMBEDDINGS_DRY_RUN=false` في Cloud Run (us-central1) | ✅ مفعّل |
| Phase 2 | أدوات صادق (4a168ea8) — create_order, log_payment_claim, schedule_followup, send_product_media, handoff_to_human | ✅ مفعّلة عبر SQL مباشر |

---

## Hotfix Lane — سجل الأعطال الإنتاجية

| الرمز | العطل | الحالة | Commit |
|---|---|---|---|
| PD-1 | الإرسال اليدوي لا يصل للعميل | ✅ محلول | (سابق) |
| PD-2 | رد الوكيل لا يظهر في الوارد | ✅ محلول | (سابق) |
| PD-3 | الوسائط في الوارد (عرض + إرسال) | 🔧 إصلاح رد الوكيل على الصور (H8-1) | — |
| PD-4 | وسائط المنتج من الكتالوج | ⛔ مؤجّل — يحتاج `catalog_management` | — |
| PD-5 | مكالمات واتساب | ⛔ مؤجّل — يحتاج `business_calling` | — |
| PD-6 | IG/Messenger: الربط + الاستقبال + الإرسال | ✅ محلول | (سابق) |
| H5-1 | نص تجريبي يصل للعميل | ✅ محلول | (سابق) |

---

## البنية التقنية (للمرجع السريع)

| المكوّن | المسار | الدور |
|---|---|---|
| api-server | `artifacts/api-server/` | Express 5 — HTTP + webhooks + SSE |
| outbox-worker | `artifacts/outbox-worker/` | يـpoll كل 3s — يرسل لـMeta + يشغّل الوكيل كل 5s |
| web | `artifacts/web/` | React 19 + Vite — لوحة التحكم |
| db | `packages/db/` | Drizzle ORM + schema |

**قنوات Meta:** واتساب (Tech Provider token) · Instagram (page token مشفّر AES-256-GCM) · Messenger (page token مشفّر)

**نشر تلقائي:** كل push على `main` → Cloud Build → api-server + worker (~3 دقائق)

---

---

## النطاق 6 — التفصيل

### مُكتمل ✅
| الرمز | الإصلاح | الملف |
|---|---|---|
| R6-1 | Worker يكتب heartbeat كل 10s → `/readyz` تعمل صحيح | `outbox-worker/src/index.ts` |
| R6-2 | Cleanup loop كل 5 دقائق → cleanup-outbox + cleanup-domain-events | `outbox-worker/src/index.ts` |
| R6-3 | `logAlert()` يبثّ JSON هيكلي (`severity=CRITICAL`) عند الفشل الدائم → Cloud Monitoring log-based alert | `outbox-worker/src/index.ts` |
| R6-4 | حذف `outbox.service.ts` + 4 routes الميتة | `integrations.routes.ts` + حذف الملف |
| R6-5 | حذف `catalog-sync.ts` اليتيم | حذف الملف |

### يدوي (لا يحتاج كود)
| الرمز | الإجراء |
|---|---|
| R6-6 | `gcloud run services update khadamatak-staging --min-instances=1 --region=us-central1 --project=khadamatk-auth` |
| R6-3 alert | في Cloud Logging → Log-based alerts → Filter: `jsonPayload.alert="outbox.permanently_failed" OR jsonPayload.alert="domain_event.failed"` |

---

## النطاق 7 — التفصيل

### مُغلق ✅
| الرمز | الإصلاح | الملف |
|---|---|---|
| Q7-1 | `EMBEDDINGS_DRY_RUN` + `AI_EMBEDDINGS_DRY_RUN` كلاهما مقبول → Vertex embeddings تعمل فعلاً | `services/embeddings.ts` |

### جيد بلا تعديل ✅
| البند | الحالة |
|---|---|
| عزل workspaceId في كل استعلام معرفة | ✅ |
| `rebuildDocumentChunks` عند الإنشاء/التحديث/إعادة-الفهرسة | ✅ |
| الاسترجاع الهجين (TSV + vector) مسلّك للوكيل | ✅ (Q5-1) |

---

## النطاق 8 — الوسائط (PD-3)

### مُكتمل ✅
| الرمز | الإصلاح | الملف |
|---|---|---|
| M8-1 | بروكسي عرض الوسائط الواردة عبر Graph API | `meta-media.ts` + `conversations.routes.ts` |
| M8-2 | عرض المرفقات في الوارد | `InboxPage.tsx` |
| M8-3 | إرسال صورة يدوياً عبر رابط HTTPS (واتساب) | `conversations.routes.ts` + worker |
| M8-4 | ربط `loadMediaContext` بحلقة الوكيل الحيّة | `agent-reply.ts` |
| M8-5 | إرسال وسائط IG/Messenger عبر رابط HTTPS | `outbox-worker/index.ts` + `conversations.routes.ts` |

### مؤجّل (coming_soon) ⛔
| البند | السبب |
|---|---|
| رفع ملف مباشر (GCS) | يحتاج مسار تخزين + مسح |
| تفريغ الصوت للوكيل | يحتاج Vertex speech API |

### بوابة الإغلاق — اختبار يدوي مطلوب
1. صورة واردة من واتساب تظهر في الوارد
2. إرسال صورة برابط من الوارد → تصل للعميل (WA/IG/Messenger)
3. النص العادي ما زال يعمل

---

## النطاق 9 — الأتمتة والمتابعة والبث (فُحص 16 يونيو 2026)

**الخريطة:**
- `automations` + `automation-engine.ts` (worker) — محرّك كامل (شروط+إجراءات: send.template, add.tag, assign.conversation, create.task, create.followup) **لكنه غير مستورد في `index.ts` → لا يعمل أبداً حياً**.
- تعارض كامن: استعلام claimDomainEvents في automation-engine يأخذ كل event_type ما عدا catalog.sync — يتداخل مع agent-runner الذي يأخذ `message.received/echo` بالتحديد. لو وُصِّل بدون تعديل، الاثنان يتنافسان على نفس الصفوف (FOR UPDATE SKIP LOCKED يمنع الازدواج، لكن لو فاز automation-engine يضيع رد الوكيل على تلك الرسالة).
- `schedule_followup` (أداة الوكيل) → يُنشئ صفاً في `followups` فقط؛ لا إرسال تلقائي — تذكير لموظف يعرضه `GET /followups?due=true`. **سلوك سليم ومقصود، ليس عطلاً.**
- `agent-learning.ts` (worker) — **غير مستورد أيضاً** → `learned_answers` فارغة دائماً. أثر منخفض (صمت، لا ضرر).
- `billing-maintenance.ts` (worker) — **غير مستورد أيضاً** → الاشتراكات لا تنتقل active→grace→expired تلقائياً أبداً (يخص الفوترة، اكتشاف عرضي).
- **Q9-1 (عطل مؤكّد):** `broadcasts.service.ts: startBroadcast()` يُدرج outbox event بحمولة `{ contactId, templateId, variableMapping }` بلا حقل `to` وبلا `templateName/language` — والـworker يرفض فوراً أي event بلا `to`. **كل حملة بث ستفشل 100% من رسائلها — الميزة معطّلة كاملاً منذ إنشائها.**
- لا يوجد أيضاً مسار يُحدِّث `broadcast_recipients.status/sentAt` بعد نجاح إرسال الـworker — حتى بعد إصلاح `to`، شاشة تتبّع الحملة ستبقى "queued" دائماً.

**بوابة الإغلاق:** ❌ — البث معطّل كلياً (Q9-1)، الأتمتة لا تعمل حياً (يتيمة).

**قرار المالك:** الحد الأدنى للبث الآن، تأجيل الأتمتة.

### مُغلق ✅
| الرمز | الإصلاح | الملف |
|---|---|---|
| Q9-1 | `startBroadcast()` يبني `to` (هاتف العميل) + `templateName/language` + `components` من `variableMapping` بدل حمولة ناقصة كانت تفشل 100% | `broadcasts.service.ts` |
| — | الأتمتة: فُحصت واجهة `AutomationsPage` — العنوان الفرعي يقول صراحة "بدون تنفيذ تلقائي مباشر في هذه المرحلة" — **صادقة بالفعل، لا تعديل لازم** | — |

### مؤجّل (بقرار المالك) ⛔
| البند | السبب |
|---|---|
| توصيل `automation-engine.ts` بالـworker | يحتاج فصل تعارض مع agent-runner أولاً؛ مؤجّل |
| تتبّع حالة البث (sent/delivered/failed) في `broadcast_recipients` بعد إرسال الـworker | إصلاح لاحق، خارج الحد الأدنى الحالي |
| `agent-learning.ts` / `billing-maintenance.ts` (worker، يتيمتان) | أثر منخفض / يخص الفوترة — تُسجَّل فقط |

**typecheck + build:** api-server ✅

**متبقٍّ للـstaging:**
```
artifacts/api-server/src/modules/broadcasts/broadcasts.service.ts
WESAL_ONE_CHAT_HANDOFF.md
```
3. النص العادي ما زال يعمل
