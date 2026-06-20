# WESAL ONE — الحالة الحيّة
آخر تحديث: 20 يونيو 2026

---

## 🔒 خطة الإطلاق — النطاقات 1–7 ✅ · 8 مؤجَّل ⏸️ · 9 ✅ · 10 ✅ (20 يونيو 2026، Claude Code)

### النطاق 1 — المصادقة والجلسات · **اجتاز البوابة** ✅
فحص read-only: جلسات خادم (PostgreSQL/connect-pg-simple، 24س)، كوكي httpOnly+secure(prod)+sameSite=lax، SESSION_SECRET مطلوب و≥32 حرف في الإنتاج، bcrypt salt=12، خطأ موحّد للدخول، session fixation محمي بـregenerate، honeypot+challenge على التسجيل، rate limits (login 8/15دق، signup 3/س). إعادة/تغيير كلمة المرور تُبطل **كل** الجلسات.
- **إصلاح مدفوع (`1e6acd5`):** حجب الحساب كلياً حتى تأكيد البريد (middleware `requireVerifiedEmail` على كل المسارات عدا `/auth/*`) + شاشة حجب في الواجهة + المُرسِل `support@wesal.one`.
- **ملاحظة منخفضة (غير حاجزة):** `POST /logout` يُبطل الجلسة الحالية فقط لا كل الأجهزة (`deleteUserSessions` موجودة لكن غير مستدعاة هنا).

### النطاق 2 — عزل العملاء (Tenant Isolation) · **اجتاز البوابة** ✅ (الأخطر)
فحص read-only شامل لكل المسارات والوحدات:
| ما فُحص | النتيجة |
|---|---|
| مصدر `workspaceId` | **صفر** حالات من body/params/query — دائماً من الجلسة (خادم). أساس العزل صلب. |
| استعلامات بالـid (~140) | كلها مقترنة بـ`eq(...workspaceId, activeWorkspaceId)` داخل `and(...)` — لا IDOR. |
| استعلامات أحادية الشرط `.where(eq(id))` | كلها على PK داخلي مولّد من استعلام مُقيّد مسبقاً (find-then-update) أو على workspace الجلسة نفسه. |
| المُجمِّعات (dashboard/analytics ~30 استعلام) | كلها مقيّدة بـworkspaceId — نقطة التسرّب الكلاسيكية محكمة. |
| عزل القناة (webhook وارد) | الـworkspace يُشتق من `phone_number_id` المملوك لحساب القناة + توقيع HMAC SHA-256 بـ`timingSafeEqual` قبل المعالجة. لا تقاطع بين العملاء. |
| سجلّات التدقيق | `createAuditLog` يتطلّب `workspaceId` في كل استدعاء. |

**القرار المعماري:** العزل يعتمد على تقييد يدوي لكل استعلام بـ`workspaceId` من الجلسة (لا RLS بعد). مطبَّق باتساق لافت عبر كل الوحدات.
**توصية تصليب لاحقة (غير حاجزة):** إضافة Postgres Row-Level Security كطبقة دفاع عميق — حتى لو نُسي فلتر واحد مستقبلاً لا تتسرّب البيانات. الخطة تصنّف RLS «مثالياً» لا إلزامياً.

### النطاق 3 — الأسرار والاعتمادات · **اجتاز البوابة** ✅
| ما فُحص | النتيجة |
|---|---|
| المسارات الداخلية | `/internal/*` (cleanup-outbox، cleanup-domain-events، agent-reply) كلها خلف `requireInternalSecret` بمقارنة `timingSafeEqual` ثابتة الزمن، fail-closed (503 إن غاب السر، 401 إن اختلف). |
| توكنات ميتا | تُخزَّن كـ`credentialsSecretRef` (إشارة لـSecret Manager، لا توكن خام)؛ ردود الـAPI تكشف `Boolean(...)`/`hasCredentialReference` فقط. |
| تسريب التوكن في اللوق | لا يُسجَّل أبداً — فقط `channelAccountId`؛ اللوق ينقّح `authorization`/`cookie`/`set-cookie`؛ التوكن في رأس HTTP لميتا فقط. |
| أسرار مكتوبة نصاً | **صفر** (مسح Google/OpenAI/Meta/private keys/Slack عبر المستودع كلّه). |
| ملفات `.env` | فقط `.env.example` (قيم نائبة) متعقَّب؛ `.gitignore` يغطّي `.env`/`.env.*`/`*.env.local`. |
| تاريخ git (229 commit) | **صفر** أسرار حقيقية — فقط قوالب `<PASSWORD>` في وثائق النشر. |
| أسرار البيئة | `SESSION_SECRET`/`INTERNAL_SECRET` مطلوبة من env (حقن Secret Manager على Cloud Run) + فحص قوّة. |

**ملاحظة معمارية (غير حاجزة — نشِطة قبل التوسّع):** مُحلِّل Secret Manager وقت التشغيل لتوكنات العملاء الفردية (`credentialsSecretRef`) **غير مُفعَّل بعد** — `getAccessToken` يرجع لـ`META_SYSTEM_USER_TOKEN`/`META_ACCESS_TOKEN` من env (توكن نظام مزوّد تقني، في Secret Manager لا مكشوف) ويسجّل تحذيراً عند وجود إشارة فقط. كافٍ للنموذج الحالي؛ يجب تفعيل المُحلِّل عند إدخال تجار كثُر بتوكنات منفصلة. لا تسريب — كل التوكنات في Secret Manager.

### النطاق 4 — متانة القنوات الثلاث · **اجتاز البوابة** ✅
| ما فُحص | النتيجة |
|---|---|
| تحقق HMAC | `verifyMetaSignature` (HMAC-SHA256 + `timingSafeEqual`) يُنفَّذ **قبل** أي معالجة على POST /meta؛ fail-closed (لا سرّ → رفض الكل)؛ لا تجاوز بأي علَم بيئة. GET يفحص verify-token. |
| تعميم الاستقبال | القنوات الثلاث: واتساب (`handleMetaPayload`)، إنستغرام + ماسنجر (`ingestMetaChannelMessage` المشترك) — كلها تنشئ `domain_events: message.received` → توقظ حلقة الرد (إصلاح PD-6). |
| تعميم الإرسال | `outbox-worker` يوجّه حسب `channel_type`: إنستغرام→`igAccountId/messages`، ماسنجر→`pageId/messages`، واتساب→`phoneNumberId/messages` (`messaging_product`). |
| عزل القناة | كل وارد يشتق `workspaceId` من حساب القناة (phone_number_id/igAccountId/pageId)؛ كل الاستعلامات مقيّدة. |
| نافذة 24 ساعة | إعادة استخدام محادثة خلال 24س؛ صادر واتساب يفرض 24س → تصعيد للبشر عند الانتهاء (Q3). |
| أخطاء الإرسال | إعادة 3 مرات بـbackoff (60s/120s) → فشل دائم → `logAlert` + تصعيد المحادثة للبشر (Q4). لا فشل صامت. |
| إصدار Graph موحّد | `META_GRAPH_VERSION` واحد عبر كل المسارات. |
| منع التكرار | dedup بـ`providerMessageId` على كل مسارات الوارد. |

**ملاحظتان طفيفتان (غير حاجزتين):** (1) تطبيقان لاستقبال واتساب (`handleMetaPayload` + `handleMetaWhatsAppWebhook`)؛ الثاني ميت من مسار الـwebhook (تكرار صيانة لا خلل). (2) فرض نافذة 24س الاستباقي لواتساب فقط؛ ماسنجر/إنستغرام يعتمدان رفض المنصّة + مسار الإعادة/الفشل.

### النطاق 5 — وقت تشغيل الوكيل · **اجتاز البوابة** ✅ (20 يونيو 2026)
| ما فُحص | النتيجة |
|---|---|
| تعميم `runAgentReply` على القنوات الثلاث | ✅ `runAgentReply` لا يعتمد على نوع القناة — يولّد الرد النصي فقط. `/internal/agent-reply` يُدرج في outbox بـeventType مخصص: `message.send.instagram.text` / `message.send.messenger.text` / `message.send.whatsapp.text`. معمّم بالكامل. |
| أداة `create_order` | ✅ schema Zod + recalcOrderTotal + audit log + contact timeline + domain event. مقيّدة بـworkspaceId. |
| أداة `log_payment_claim` | ✅ تسجّل `status="pending"` فقط — لا تأكيد مالي إطلاقاً. SAFETY_SYSTEM_PROMPT يحظر ذلك صراحةً. |
| أداة `schedule_followup` | ✅ تتحقق من وجود contactId؛ تُنشئ followup مرتبطاً بالمحادثة. |
| أداة `handoff_to_human` | ✅ تُحدّث `agentStatus="human"` + `needsHuman=true` + `escalationReason`؛ تُطلق SSE event. |
| أداة `send_product_media` | ✅ تبحث عن منتج بالاسم/id؛ تُدرج outbox `message.send.whatsapp.media`. فعلياً خاصة بواتساب (الـeventType ثابت). |
| أمان تفعيل الأدوات | ✅ الأداة تعمل فقط إن `isEnabled=true AND !requiresApproval` في `ai_agent_tools` (per-agent config). |
| حماية فشل AI | ✅ `runAIWithTimeout` 30 ثانية + `fallbackUsed→shouldEscalate` (صامت للبشر، لا نص تجريبي للعميل). |
| منع تسريب JSON | ✅ `sanitizeReply` + `parseAgentToolResponse` (هروب أحرف التحكم + heuristic extraction) — لا يصل JSON خام للعميل. |
| حماية التكرار (anti-loop) | ✅ `consecutive_agent_replies >= 2` → توقف مؤقت؛ `message.echo` → إيقاف مؤقت. |
| كلمات التصعيد | ✅ `ESCALATION_KEYWORDS` ("أكلم إنسان"/"مدير"/"شكوى"/"إلغاء") → تصعيد فوري. |
| استرجاع المعرفة | ✅ بحث هجين ثلاثي: TSV (PostgreSQL full-text) + Lexical (ilike) + Vector (cosine similarity مع `text-embedding-005`). |
| عزل المعرفة | ✅ كل استعلامات المعرفة مقيّدة بـworkspaceId. |
| معالجة الوسائط | ✅ `loadMediaContext` يجلب الصور كـbase64 للنموذج؛ دمج metadata النصي للصوت/الفيديو؛ يتعامل مع dry-run بأمان. |
| مزوّد AI | ✅ Vertex AI (الإنتاج) ← Gemini (احتياط) ← Mock (تجريبي). Vertex يستخدم GCP metadata token (لا سر مكشوف). |
| SAFETY_SYSTEM_PROMPT | ✅ يحظر صراحةً تأكيد/رفض المدفوعات، تغيير الأرصدة، حذف البيانات، تغيير الصلاحيات. |

**ملاحظتان (غير حاجزتين):**
1. **`send_product_media` لواتساب فقط:** الـoutbox eventType ثابت على `whatsapp.media` — إذا فعّلها تاجر على إنستغرام/ماسنجر، ستفشل الأداة بـ`hasToolProblem=true` ويُرسَل رد افتراضي "أحتاج أن أحوّل طلبك للفريق". لا ضرر للعميل، لكن يجب توثيق القيد للتجار.
2. **`EMBEDDINGS_DRY_RUN` صحيح بالافتراضي:** التضمينات الـvector تستخدم pseudo-hash إلا إذا عُيِّن `EMBEDDINGS_DRY_RUN=false` + `VERTEX_PROJECT_ID` في Secret Manager. البحث النصي (lexical+TSV) يعمل دائماً، لكن جودة البحث الدلالي أعلى مع Vertex. **يجب التأكد من تعيين هذين المتغيّرين في Cloud Run.**

### النطاق 6 — الموثوقية والتشغيل · **اجتاز البوابة** ✅ (20 يونيو 2026)
| ما فُحص | النتيجة |
|---|---|
| Idempotency (لا ردود مكررة) | ✅ `outbox_events.idempotency_key` مع `onConflictDoNothing()` — محادثة واحدة لا تُرسَل مرتين. domain_events: `FOR UPDATE SKIP LOCKED` — نسختان متوازيتان لا تتعارضان. وارد Meta: dedup بـ`providerMessageId`. |
| Retry الفاشل (outbox) | ✅ 3 محاولات بـbackoff (60s/120s) → فشل دائم → `logAlert(outbox.permanently_failed)` + تصعيد المحادثة للبشر. |
| Retry الفاشل (domain_events) | ✅ العالق في `processing > 10` دقائق يُعاد إلى `pending` تلقائياً عبر `/internal/cleanup-domain-events` (كل 5 دقائق). الفاشل نهائياً يُعلَّم `failed` ومرئي في Cloud Logging. |
| Cleanup stale | ✅ `runCleanup` كل 5 دقائق: outbox (processing/pending > 5 دق → failed)؛ domain_events (processing > 10 دق → pending). |
| Alerting | ✅ `logAlert` يكتب `{severity:"CRITICAL", alert:type}` على stdout → Cloud Logging يلتقطه → يمكن إنشاء log-based alerts على `outbox.permanently_failed` + `domain_event.failed`. |
| Heartbeat | ✅ `writeHeartbeat` كل 10 ثوان → جدول `service_heartbeats` → مراقبة خارجية ممكنة. |
| Deploy pipeline | ✅ triggeران منفصلان (api-server + worker)؛ `CLOUD_LOGGING_ONLY`؛ `ON_ERROR_STOP=1` يُفشل البناء عند خطأ SQL؛ `verify-migration` يتحقق من 6 جداول حرجة. |
| Loop protection | ✅ `startLoop` يمنع تداخل جولتين (علَم `running`). `--max-instances=1` على Cloud Run → نسخة واحدة. |
| رؤية الأخطاء | ✅ أخطاء outbox + domain events تُسجَّل بـ`logger.error` + `logAlert(CRITICAL)` → مرئية في Cloud Logging. |

**ملاحظتان (غير حاجزتين):**
1. **`EMBEDDINGS_DRY_RUN` غائب من Cloud Build:** لا يُعيَّن `EMBEDDINGS_DRY_RUN=false` في `cloudbuild.yaml` أو `cloudbuild.worker.yaml` — البحث الدلالي يعمل بـpseudo-hash في الإنتاج. يجب إضافته لأحد `--set-env-vars` في deploy-staging step. **متوسطة — تؤثر على جودة الاسترجاع، لا على الاستقرار.**
2. **outbox SELECT بلا SKIP LOCKED:** `runOutboxSender` يقرأ outbox بلا قفل صفوف — محمية بـ`max-instances=1` حالياً، لكن `idempotency_key` + `onConflictDoNothing` كافيان لمنع إدراج مكرر حتى لو تغيّر ذلك. **منخفضة.**
3. **verify-migration يتحقق من الجداول لا الأعمدة:** الملاحظة الموثّقة من PD-12 — يُوصى بتوسيعه للأعمدة الحرجة. **منخفضة — موثّقة مسبقاً.**

### النطاق 7 — حماية البيانات والامتثال · **اجتاز البوابة** ✅ (20 يونيو 2026)

| ما فُحص | النتيجة |
|---|---|
| TLS / HTTPS | ✅ Cloud Run يُنهي TLS على مستوى البنية التحتية — كل الطلبات HTTPS إلزاماً. `app.set("trust proxy", 1)` صحيح لـCloud Run. |
| رؤوس الأمان | ✅ `securityHeaders.ts`: `X-Frame-Options: DENY`، `X-Content-Type-Options: nosniff`، `Referrer-Policy: strict-origin-when-cross-origin`، `Permissions-Policy: camera=(), microphone=(), geolocation=()`. |
| CORS | ✅ `ALLOWED_ORIGINS` فارغة في الإنتاج → رفض كل الأصول الأجنبية؛ مع قائمة → الأصول المدرجة فقط. `credentials: true` بأمان مع فحص الأصل. |
| تشفير في السكون | ✅ Cloud SQL PostgreSQL: تشفير AES-256 افتراضي من Google؛ Cloud SQL Proxy يُشفّر الاتصال بين Cloud Run والقاعدة. |
| النسخ الاحتياطي | ✅ `docs/ops/BACKUP.md` موجود مع تعليمات التحقق والإنشاء اليدوي والاستعادة. `DEPLOY_RUNBOOK.md` يتضمّن `--backup-start-time=03:00` — النسخ اليومي مُدرج في أمر إنشاء الـinstance. |
| تسجيل IP | ✅ `audit_logs.ip_address` مسجَّل على كل حدث حساس؛ `login_events.ip_address` مسجَّل على كل محاولة دخول (نجاح + فشل). |
| سلامة سجلّات التدقيق | ✅ `audit.ts` يحمل `APPEND-ONLY GUARD` — لا UPDATE/DELETE على `audit_logs` في كود الخدمة. التعليق يُرشد لإضافة PostgreSQL RULE في الإنتاج. |
| حذف جهات الاتصال | ✅ `DELETE /contacts/:id` = حذف ناعم (`archivedAt`) مع audit log + timeline. البيانات تبقى مقيّدة بالـworkspace. |
| تعطيل الـWorkspace | ✅ `POST /workspace/deactivate` يعيّن `status="deactivated"` + `deactivatedAt` + سبب مع تأكيد بالاسم + audit log. |

**ملاحظات (غير حاجزة للبايلوت):**
1. **HSTS مفقود:** `securityHeaders.ts` لا يُضيف `Strict-Transport-Security` — أضفه: `res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")`. **منخفضة.**
2. **PITR غير مؤكّد:** `replit.md` يُشير إلى `❌ Not configured` للـPoint-in-Time Recovery. فعّله من Cloud Console قبل أول عميل مدفوع. **متوسطة — بعد البايلوت.**
3. **لا اختبار استعادة موثَّق:** `BACKUP.md` ينصح بالاختبار لكن لا سجلّ لاختبار فعلي. نفّذ استعادة تجريبية على instance مؤقتة قبل التوسّع. **متوسطة.**
4. **لا مسار محو بيانات (Right to Erasure):** الحذف الناعم فقط — لا endpoint لمحو البيانات بالكامل. PDPL السعودي يُلزم بإتاحة طلبات المحو. للبايلوت: حدّد عملية يدوية موثّقة (script دعم) مؤقتاً. **مهمة — قبل الإطلاق العام.**
5. **لا DPA / سياسة خصوصية:** لا ملف عقد معالجة بيانات في الكود. ابدأ بوثيقة بسيطة قبل التعاقد مع التجار. **مهمة — قبل الإطلاق العام.**
6. **لا سياسة احتفاظ للبيانات:** `audit_logs` و`login_events` تنمو بلا تنظيف. وثّق سياسة (مثلاً 90 يوماً لـlogin_events) قبل التوسّع. **منخفضة.**
7. **PostgreSQL RULE للتدقيق غير مؤكّد في الإنتاج:** الكود يُرشد لإضافته لكن لا دليل على تطبيقه على Cloud SQL. **منخفضة.**

### النطاق 8 — الفوترة والحدود والحصص · **مؤجَّل بقرار المالك** ⏸️ (20 يونيو 2026)

**قرار المالك (20 يونيو):** تأجيل فحص/إغلاق نطاق الفوترة والانتقال مباشرةً إلى نطاق 9 (التصليب الأمني). لا يحجب الإطلاق التجريبي.

**رصد أوّلي (read-only، غير مكتمل — للسياق فقط):**
- البنية موجودة وسليمة شكلاً: `services/billing.ts` فيه `checkLimit` (channels/agents/monthly_messages/team_members/contacts) + `recordUsage` (عدّادات شهرية بـ`onConflictDoUpdate`) + `getActiveSubscription` + `getUsageSnapshot` + `getLimitWarnings`.
- الفرض مطبَّق فعلاً في بعض المسارات: إنشاء وكيل يُرجع `402` عند تجاوز حد الوكلاء (`ai.routes.ts`).
- بوابة الثقة (`trust-gate.ts`) تفرض حصصاً تشغيلية: `dailyAutoSendQuota`، `maxAutoRepliesPerConversation`، قوائم منع/مواضيع/عتبة ثقة.
- باقات `seed.ts`: free(200 رسالة)/basic(1000)/pro(5000)/unlimited — حدود معرّفة لكل باقة.
- **ما يحتاج فحصاً عند العودة:** هل `checkLimit("monthly_messages")` مفروض فعلاً قبل إرسال كل رسالة صادرة؟ هل `recordUsage` مستدعى في مسار الإرسال؟ منع تجاوز الحصة على القنوات. (مؤجَّل.)

**الحالة:** ⏸️ مؤجَّل — يُعاد فتحه بقرار المالك بعد نطاق 9.

### النطاق 9 — التصليب الأمني الشامل ✅ مُغلق (20 يونيو 2026)

> **منهجية:** فحص بكوديكس (read-only، gpt-5.5) ككادح، وكلود مشرفاً **تحقّق من كل ادّعاء بنفسه** قبل الاعتماد. تدقيق التبعيات شغّله كلود (sandbox كوديكس منعه).

**ما هو صلب (مُتحقَّق):**
| ما فُحص | النتيجة |
|---|---|
| تحديد المعدّل | ✅ شامل: `authLimiter` على register/login/forgot/reset/change-password/resend؛ `aiRunLimiter` على تشغيل AI؛ `paymentActionLimiter` على تأكيد/رفض الدفع؛ `reportGenerateLimiter`؛ `apiLimiter` عام (300/دق، مفتاح session-or-IP). |
| CORS | ✅ مقفل إنتاجياً — `ALLOWED_ORIGINS` فارغة ⇒ رفض كل الأصول الأجنبية؛ مع قائمة ⇒ المُدرَجة فقط. |
| رؤوس الأمان | ✅ `X-Frame-Options: DENY`، `X-Content-Type-Options: nosniff`، `Referrer-Policy`، `Permissions-Policy`، `X-Request-Id`. |
| حقن SQL | ✅ لا تركيب نصّي خام لمدخل مستخدم — كل استعلامات Drizzle مُمعلَمة (`${value}`). |
| تسريب آثار الأخطاء | ✅ المعالج العام في `app.ts` يرجع رسالة عربية موحّدة + code؛ **لا `err.stack` للعميل أبداً**. |
| تحقّق Zod | ✅ الغالبية العظمى من مسارات POST/PATCH/PUT تمرّ بـ`safeParse(req.body)` قبل المنطق. |

**ملاحظات مُتحقَّقة (تصليب — غير حاجزة للبايلوت المغلق):**
1. **webhook ميتا بلا تحديد معدّل:** `POST /api/webhooks/meta` مُركَّب **قبل** `apiLimiter` ولا يستخدم `webhookLimiter`. والأخير (`rateLimiter.ts:94`، 600/دق) **مُعرَّف ومستخدَم لا مكان**. HMAC SHA-256 يرفض الطلبات المزيّفة رخيصاً (خطر DoS محدود)، لكن وصْل المحدّد الجاهز = سطر واحد. **متوسطة-منخفضة.**
2. **تسريب `err.message` في auth:** `auth.routes.ts:133` (register) و`:186` (login) يمرّران `err.message` الخام للعميل. الرسائل التجارية مقبولة، لكن خطأ داخلي غير متوقّع قد يكشف نصّه (500/401). يُفضّل رسالة موحّدة للحالة غير التجارية. **منخفضة-متوسطة (كشف معلومات).**
3. **`switch-workspace` بفحص يدوي لا Zod:** `auth.routes.ts:393` يقرأ `req.body.workspaceId` بفحص `typeof` — لكن **العضوية مُتحقَّقة** (403 لغير العضو) ⇒ العزل سليم. تفاوت أسلوبي. **منخفضة.**
4. **HSTS مفقود:** (نفس ملاحظة نطاق 7) — أضِف `Strict-Transport-Security`. CSP مُفوَّض للواجهة عمداً. **منخفضة.**

**تصحيحات إشرافية (بالغ كوديكس — صُحّحت):**
- `followups POST`: كوديكس قال "يقرأ contactId قبل التحقق" — لكن `safeParse` يلي مباشرةً (سطر 113) + فحص ملكية workspace. **ليست ثغرة.**
- `integrations/webhooks.routes.ts`: كوديكس نفسه لاحظ أنه **غير مُركَّب** في `routes/index.ts` — مسار ميّت، بلا أثر.

**تدقيق التبعيات (`pnpm audit --prod` — شغّله كلود):** ~~5 ثغرات (1 عالية + 4 متوسطة)~~ → **No known vulnerabilities found** ✅ (بعد تطبيق `pnpm.overrides`)

**دفعة التصليح المُطبَّقة (20 يونيو 2026):**
| # | الملف | التصليح |
|---|---|---|
| 1 | `securityHeaders.ts` | أُضيف `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| 2 | `routes/index.ts` | وُصِل `webhookLimiter` (600/دق) على `/webhooks` قبل `apiLimiter` |
| 3 | `auth.service.ts` | أُضيفت `class AuthError`؛ 6 `throw new Error` → `throw new AuthError` |
| 4 | `auth.routes.ts` | catch blocks: `AuthError` → رسالة العميل؛ خطأ مجهول → `"حدث خطأ داخلي"` |
| 5 | `package.json` | `pnpm.overrides`: path-to-regexp@8.4.0، qs@6.15.2، ip-address@10.1.1، postcss@8.5.10 |

**النتيجة:** `corepack pnpm run typecheck` (api-server) → صفر أخطاء ✅ · `pnpm audit --prod` → صفر ثغرات ✅

**بوابة الإغلاق:** ✅ **أساس أمني صلب + دفعة التصليح مُطبَّقة ومُتحقَّقة.** TypeScript يمرّ، audit نظيف. جاهز للدفع.

---

### النطاق 10 — الإعداد وتجربة التاجر ✅ مُغلق (20 يونيو 2026)

**ما فُحص:** معالج الإعداد، التوجيه بعد التسجيل، Playground، وضع الثقة.

**ما هو موجود:**
- `/start` → `BusinessSetupPage`: 6 بطاقات قابلة للنقر (ربط قناة → وارد → معرفة → وكيل → كتالوج → مراقبة)
- اختيار القطاع والموقع — يُحفظ في workspace settings
- Dashboard (موبايل + ديسكتوب): دليل التشغيل السريع (5 خطوات)
- Playground في `AgentDetailPage`: تبويب كامل مع نص، تشغيل، نتيجة
- وضع الثقة: suggest / auto / auto_after_hours

**التصليحات المُطبَّقة:**
| الملف | التصليح |
|---|---|
| `RegisterPage.tsx:34` | `navigate("/dashboard")` → `navigate("/start")` — التاجر الجديد يصل للدليل التفاعلي مباشرةً |
| `DashboardPage.tsx` | أُضيف زر "فتح دليل الإعداد الكامل" (→ `/start`) في بطاقة الخطوات — موبايل وديسكتوب |

**ملاحظات غير حاجزة (موثّقة):**
- لا بوابة Playground إلزامية قبل وضع auto — مقبول للبايلوت المغلق، يُراجع قبل الإطلاق العام.
- لا تتبّع إتمام الخطوات (checkmarks) — UX improvement مستقبلي.

**typecheck:** صفر أخطاء (web) ✅

**بوابة الإغلاق:** ✅ تاجر جديد يسجّل → يصل `/start` مباشرةً → يتبع الدليل التفاعلي → يشغّل وكيله بلا مساعدة يدوية.

---

## ⏳ نطاق المخزون (منتجات) — متطلبات مقفلة (20 يونيو 2026)

**الطلب (المالك):** ربط الطلبات بكتالوج منتجات من المخزون، مع سياسة توصيل على مستوى المنتج.

**المتطلبات المقفلة:**

| # | المتطلب | الملاحظة |
|---|---|---|
| M-1 | جدول `products`: اسم، سعر، وحدة، وصف، صورة، كمية متاحة | الأساس |
| M-2 | سياسة التوصيل على المنتج: `pickup_only` / `local` / `all` | تُقيّد خيارات التسليم في نموذج الطلب تلقائياً |
| M-3 | ربط `order_items.product_id → products.id` | عند إضافة بند من المخزون يُسحب الاسم والسعر تلقائياً |
| M-4 | زر "اختر من المخزون" في نموذج بند الطلب | إضافة يدوية تبقى كما هي (للأصناف غير المسجّلة) |
| M-5 | صفحة إدارة المخزون | إضافة/تعديل/أرشفة منتج؛ تتبّع الكمية |
| M-6 | الأقسام في نموذج الطلب لا تتغيّر بناءً على نوع التسليم | سياسة التوصيل تُفلتر الخيارات، لا تُخفي أقساماً |

**الحالة:** ⏸️ معلّق — يُفتح بعد إغلاق نطاق 12 (مدفوعات). نطاق 11 معلّق أيضاً ريثما يُبنى المخزون (الدفعة 3 + ربط المنتجات).

---

## ⏸️ توسعة النطاق 11 — التوصيل والسندات والدفع عند الاستلام (20 يونيو 2026، Claude Code)

**الطلب (المالك):** قسم طلبات تشغيلي عام — فصل تفاصيل/تعديل، حالة التوصيل، نوع التسليم (استلام/مندوب داخلي/مكتب نقل)، الدفع عند الاستلام، سند مكتب النقل (صورة/رابط) + رقمه، رقم مندوب التوصيل الداخلي، رسوم التوصيل تُضاف للإجمالي.

**المبني (3 دفعات، الدفعتان 1+2 جاهزتان):**
- **schema (migration 0028):** 9 أعمدة على `orders` (delivery_type/status, delivery_agent_phone, carrier_name/phone, delivery_receipt_url, delivery_address, delivery_fee, cod_enabled). **دُمج في `migrate-phase345.sql`** → يُطبّق تلقائياً وقت النشر قبل deploy (صفر نافذة انكسار، عكس PD-12).
- **backend (`orders.routes.ts`):** recalcTotal يضيف رسوم التوصيل؛ create/update تقبل حقول التوصيل؛ مسار جديد `PATCH /:id/delivery-status` (تدفّق حالة + يدفع الطلب لـdelivered عند اكتمال التوصيل)؛ عزل + تدقيق + صلاحيات محفوظة.
- **frontend (`OrdersPage.tsx`):** زر تفاصيل (👁 عرض) منفصل عن تعديل (✏️)؛ مكوّن `OrderEditForm` كامل؛ لوحة توصيل (timeline + أزرار تقدّم)؛ COD في ملخص الدفع؛ حقول التوصيل في الإنشاء.

**typecheck + build:** api-server ✅ web ✅ (BASE_PATH=/).

**الدفعة 3 (مؤجّلة لما بعد اختبار 1+2):** أداة وكيل `get_order_status` — يرد على "وين طلبي؟" بحالة التوصيل + رقم المندوب/المكتب.

**اختبار حيّ (20 يونيو 2026):** ✅ التوصيل ✅ التعديل ✅ تقدّم حالة التوصيل ✅ رسوم التوصيل في الإجمالي ✅ COD badge — **كلها ناجحة.**

**بوابة الإغلاق:** ⏸️ **معلّقة** — لا تُغلق حتى يكتمل نطاق المخزون ويُربط مع بنود الطلب (M-3) + الدفعة 3 (`get_order_status` للوكيل).

---

## 🔴→✅ PD-12 — انجراف schema أوقف استقبال واتساب (19 يونيو 2026، Claude Code)

**العَرَض (المالك، حيّ):** رسالة من رقم جديد لا تظهر في الوارد إطلاقاً والوكيل لا يرد — رغم أن القناة نشطة والـworkspace صحيح. **هذا هو الجذر الحقيقي لـPD-2** (لا علاقة له بـSSE).

**الجذر (مؤكّد من سجلّ Cloud Run + قاعدة الإنتاج):** عمود `contacts.custom_fields` (migration `0027`، commit `cc9baf6`) **لم يُطبّق على الإنتاج**. كل webhook وارد → `upsertContact` (`meta.routes.ts:167`) ينفّذ `UPDATE contacts … RETURNING custom_fields` → `column "custom_fields" does not exist` → الاستثناء يُبتلع بصمت («Failed to process Meta webhook») → الرسالة تسقط، لا domain_event، الوكيل لا يُستدعى. نفس السبب كسر `/api/contacts` و`cleanup-domain-events` (500).

**السبب الجذري المنهجي:** آلية النشر تطبّق `scripts/migrate-phase345.sql` (ملف ثابت) فقط؛ ملفات `lib/db/drizzle/*.sql` الجديدة لا تُطبّق تلقائياً، و0027 لم يُدمج. drizzle journal/snapshots مهجورة. → سُجّل في الذاكرة الدائمة.

**الإصلاح المطبّق على الإنتاج (Cloud Shell + cloud-sql-proxy):**
1. `ALTER TABLE contacts ADD COLUMN custom_fields, archived_at` + فهارس 0027 → **الاستقبال عاد فوراً، الوكيل رد ✅** (تأكيد حيّ من المالك).
2. دمج 0027 في `scripts/migrate-phase345.sql` (idempotent) → يمنع تكراره في أي قاعدة/نشر جديد.

**التدقيق الشامل (read-only):** 95/95 جدول موجودة · 24/24 عمود من الهجرات الأحدث موجودة · الجداول الحرجة السبعة مطابقة → **صفر انجراف متبقٍّ، الإنتاج متزامن مع الكود.**

**متبقٍّ (الطبقة 2 — يحتاج مراجعة مبرمج قبل الدفع، لأن المالك غير مبرمج):** توسيع خطوة `verify-migration` في `cloudbuild.yaml` لتفحص **الأعمدة الحرجة** لا الجداول فقط — فأي انجراف عمودي مستقبلي يُفشل النشر بدل أن يضرب عميلاً صامتاً.

**ملفات محلية غير مدفوعة:** `scripts/migrate-phase345.sql` (دمج 0027). [إصلاح SSE `realtime.ts`+`internal.routes.ts` دُفع `a85da54` — تحسين ظهور فوري، طبقة مختلفة عن الجذر.]

---

## الحالة الإجمالية

### نطاقات الميزات (Business Domains)
| النطاق | الوصف | الحالة |
|---|---|---|
| نطاق 10 — جهات الاتصال | CSV استيراد/تصدير، custom_fields | ✅ مغلق (`f52a262`) |
| نطاق 11 — الطلبات + التوصيل | أنواع التسليم، حالة التوصيل، COD، رسوم | ⏸️ اختبار حيّ ✅ — معلّق (ينتظر المخزون) |
| نطاق 12 — المدفوعات | تسجيل دفعة، حالة جزئي/مدفوع | ✅ اختبار حيّ ✅ — مغلق |
| نطاق المخزون — منتجات | كتالوج + سياسة توصيل + ربط بالطلبات | ⏳ مخطَّط (بعد نطاق 12) |

### حوادث الإنتاج
**✅ PD-7** (`9cbf5a7`). **✅ PD-8** (`a3cb4a6`، parser ثلاثي). **✅ PD-9 مدفوع** (`e091e4c`، `coerceCurrency`) — لم يُؤكَّد حيّاً بعد لأنه كان محجوباً بـPD-10/PD-11. **✅ PD-10 المرحلة 1 مدفوعة** (`3efd9ca`، فرض JSON عند تفعيل الأدوات) — المرحلة 2 (function calling) مؤجلة. **⏸️ PD-2/PD-11 مؤجلان إلى Claude Code بقرار المالك** بعد اختبار الإنتاج في 19 يونيو: الرسائل لا تظهر في الوارد، وزر «إعادة للوكيل» يختفي ويعود ولا يعمل بثبات رغم `9d4ddfb` و`8fce81b`.

> **سياق الجلسة:** اختبار `create_order` الحيّ كشف 3 طبقات على نفس المسار: PD-8 (تحليل) + PD-9 (عملة) + PD-10 (التزام صيغة الأدوات). الوكيل صمت بعد التصعيد بسبب PD-11 (فُكّ يدوياً عبر `UPDATE conversations SET agent_status='active'` للمحادثة `03f513bf`).

---

## 🟡 Hotfix PD-10 (المرحلة 1) — النموذج لا يلتزم بصيغة الأدوات (18 يونيو 2026)

**العَرَض:** `create_order` متذبذب — نفس الطلب ينجح مرة ويفشل أخرى. تشغيل 21:13 ردّ نصّاً صرفاً بلا JSON (`has_raw=f` في `ai_messages.metadata`) → لا أداة، لا طلب.

**الجذر:** JSON نصّي بلا `responseMimeType`/function calling؛ و`draft_reply` خارج `JSON_TASK_TYPES` فلا شبكة أمان لردود الوكيل.

**الإصلاح (المرحلة 1 — `ai-provider.ts` + `agent-reply.ts`):** علَم `responseFormat="json"` عند تفعيل الأدوات → `responseMimeType: application/json` + حرارة ≤0.1 + تفعيل شبكة "نص بلا JSON → تصعيد صامت". يقتل ردّ النص الصرف وفئة PD-8. **المرحلة 2 (function calling) مؤجلة بقرار المالك.**

**typecheck:** api-server ✅

**اختبار الإغلاق (يؤكّد PD-10 وPD-9 معاً):** أرسل "أطلب كرتونين مياه بـ2000 ريال يمني الدفع عند الاستلام، أكّد الطلب" → ردّ نظيف + صفّ في `orders` بعملة `YER`.

**ملف لمس:** `artifacts/api-server/src/lib/ai-provider.ts`, `artifacts/api-server/src/lib/agent-reply.ts`

---

## 🟡 Hotfix PD-11 — "إعادة فتح" لا تجعل الوكيل يرد (18 يونيو 2026)

**العَرَض:** المالك عمل "إعادة فتح" لمحادثة مصعّدة، لكن الوكيل لم يرد.

**الجذر:** "إعادة فتح" تعدّل `status` فقط، بينما الـworker يتوقف عند `agent_status='human'`. وحتى عند إعادة `agent_status='active'` يدوياً، حدث الرسالة القديم يكون غالباً `done` لأن الـworker عالجه سابقاً وهو في وضع بشري، فلا يوجد `domain_event` جديد يوقظه.

**الإصلاح v1:** في `PATCH /conversations/:id/agent-status` عند `status=active`:
1. مسح `needsHuman` و`escalationReason`.
2. نشر `message.received` جديد للمحادثة بـ`source=agent_reactivated` حتى يلتقطه الـworker فوراً.
3. في الوارد: زر واضح "إعادة للوكيل" عند حالة `human` + نفس الفعل داخل قائمة المحادثة.

**تصحيح v2 (بعد اختبار حي بالصورة):** الزر كان لا يظهر لأن الواجهة ربطته بـ`conversations:manage`، بينما مشغل الوارد يملك `conversations:resolve`. أُضيف مسار مخصص `POST /conversations/:id/reactivate-agent` محمي بـ`conversations:resolve` فقط؛ يفعل الإرجاع الآمن للوكيل ولا يعطي صلاحية إيقاف/إدارة حالات الوكيل العامة. الواجهة تستخدم هذا المسار عند `needsHuman`/`human`.

**اختبار الإغلاق:** بعد النشر، افتح محادثة بشرية واضغط "إعادة للوكيل" لا "إعادة فتح" فقط؛ يجب أن ينتج domain_event جديد، ثم outbox reply.

**نتيجة الاختبار الحي (19 يونيو 2026):** ❌ لم تُغلق البوابة. الزر يختفي ثم يعود، والرسائل لا تظهر في الوارد. يوجد تضارب مستمر بين حالة المحادثة/الوكيل ومسار تحديث الوارد. **قرار المالك:** تأجيل تشخيص PD-2 وPD-11 وإصلاحهما إلى Claude Code، وعدم إبقائهما حاجزاً أمام متابعة النطاق 10 الآن.

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
| **النطاق 5** | وقت تشغيل الوكيل | ✅ مُغلق — اختُبر حيّاً 19 يونيو (الوكيل ردّ بعد إصلاح PD-12) | `ff49ebe` `ce93b59` `c3d9d61` + PD-7 |
| **النطاق 6** | الموثوقية والتشغيل | ✅ مُغلق (R6-6 يدوي) | `86fa6cb` |
| **النطاق 7** | قاعدة المعرفة والاسترجاع | ✅ مُغلق | `86fa6cb` |
| **النطاق 8** | الوسائط (PD-3) + vision | ✅ مُغلق — اختُبر حيّاً 19 يونيو (عرض/إرسال + الوكيل يحلّل الصور بصرياً) | `86fa6cb` + `c85f2f9` |
| **النطاق 9** | الأتمتة والمتابعة والبث | ✅ مُغلق (الأتمتة مؤجّلة بقرار) | — |
| **النطاق 10** | جهات الاتصال | ✅ مُغلق — اختُبر حيّاً 20 يونيو (استيراد/تصدير CSV + custom_fields) | `cc9baf6` `f52a262` |
| **النطاق 11** | الطلبات | ✅ مُغلق — اختُبر حيّاً 20 يونيو (إنشاء، حالات، بنود، دفعات) | `bf1eaa1` |

---

## النطاق 10 — جهات الاتصال

**مدفوع:** `cc9baf6` — عزل الهوية، dedup للهاتف/واتساب، الأرشفة، الدمج في API، الحقول المخصصة، وفهارس migration `0027`.

**محلي غير مدفوع (19 يونيو 2026):** استيراد/تصدير CSV الآمن + واجهة دمج المكررات + عرض/تعديل الحقول المخصصة. typecheck للـAPI والواجهة و`build:prod` ✅.

**بوابة الإغلاق:** 🔍 تبقى مفتوحة حتى حل انجراف Drizzle journal وتطبيق migration `0027` واختبار العزل والاستيراد والدمج والبحث والصلاحيات حيّاً. لا انتقال إلى النطاق 11 قبل ذلك.

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
| PD-2 | الرسائل لا تظهر في الوارد | ✅ محلول — الجذر انجراف schema (PD-12، `custom_fields` مفقود) لا SSE؛ اختُبر حيّاً | — |
| PD-3 | الوسائط في الوارد (عرض + إرسال + vision) | ✅ محلول — الوكيل يحلّل الصور بصرياً، اختُبر حيّاً 19 يونيو | `c85f2f9` |
| PD-4 | وسائط المنتج من الكتالوج | ⛔ مؤجّل — يحتاج `catalog_management` | — |
| PD-5 | مكالمات واتساب | ⛔ مؤجّل — يحتاج `business_calling` | — |
| PD-6 | IG/Messenger: الربط + الاستقبال + الإرسال | ✅ محلول | (سابق) |
| PD-11 | زر «إعادة للوكيل» يتذبذب ولا يعيد الوكيل بثبات | ⏸️ مؤجّل إلى Claude Code بقرار المالك | `9d4ddfb` `8fce81b` |
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

### بوابة الإغلاق — مؤجلة بقرار المالك

هذه الخطوة مؤجلة الآن بقرار المالك، ولا تُقترح كخطوة تالية حتى يطلب المالك استئناف النطاق 8.

عند استئنافها لاحقاً:
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
