# WESAL ONE — الحالة الحيّة
آخر تحديث: 15 يونيو 2026

---

## الحالة الإجمالية

دفعة جاهزة للنشر — النطاقان 6–7 مُغلقان؛ النطاق 8 (PD-3) شبه مكتمل — **push بيد المالك**.

---

## جدول النطاقات

| النطاق | العنوان | الحالة | Commits |
|---|---|---|---|
| **النطاق 1** | المصادقة والجلسات | ✅ مُغلق | `4123883` |
| **النطاق 2** | عزل العملاء | ✅ مُغلق | `4f804e4` |
| **النطاق 3** | الأسرار والاعتمادات | ✅ مُغلق | `739cca0` |
| **النطاق 4** | متانة القنوات | ✅ مُغلق | `3388ab9` |
| **النطاق 5** | وقت تشغيل الوكيل | ✅ مُغلق | `ff49ebe` `ce93b59` `c3d9d61` |
| **النطاق 6** | الموثوقية والتشغيل | ✅ مُغلق (R6-6 يدوي) | `86fa6cb` |
| **النطاق 7** | قاعدة المعرفة والاسترجاع | ✅ مُغلق | `86fa6cb` |
| **النطاق 8** | الوسائط (PD-3) | 🔍 قيد التحقق | `86fa6cb` |

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
| PD-3 | الوسائط في الوارد (عرض + إرسال) | 🔍 قيد التحقق (M8-1…M8-5) | — |
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
