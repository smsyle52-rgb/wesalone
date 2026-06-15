# WESAL ONE — الحالة الحيّة
آخر تحديث: 15 يونيو 2026

---

## الحالة الإجمالية

كل الكود على `main` ومنشور في Cloud Run. لا يوجد commit معلّق.

---

## جدول النطاقات

| النطاق | العنوان | الحالة | Commits |
|---|---|---|---|
| **النطاق 1** | المصادقة والجلسات | ✅ مُغلق | `4123883` |
| **النطاق 2** | عزل العملاء | ✅ مُغلق | `4f804e4` |
| **النطاق 3** | الأسرار والاعتمادات | ✅ مُغلق | `739cca0` |
| **النطاق 4** | متانة القنوات | ✅ مُغلق | `3388ab9` |
| **النطاق 5** | وقت تشغيل الوكيل | 🔧 جزئي | `ff49ebe` `ce93b59` `c3d9d61` |
| **النطاق 6** | الموثوقية والتشغيل | ⬜ لم يُفحص | — |

---

## النطاق 5 — التفصيل

### مُغلق ✅
| الرمز | الإصلاح | Commit |
|---|---|---|
| H5-1 | تصعيد صامت عند غياب AI — لا يصل نص تجريبي للعميل | (سابق) |
| Q5-4 | idempotency عبر `domainEventId` — يمنع رد مكرر عند إعادة معالجة domain_event | `ff49ebe` |
| M5-2 | توحيد `SAFETY_SYSTEM_PROMPT` مع السلوك الفعلي — حُذف «أنت تقترح فقط» | `ce93b59` |
| Q5-1 | ربط المحرك الهجين (TSV + vector) بالوكيل الحي — بديل ILIKE البسيط | `c3d9d61` |

### معلّق ⏳
| الرمز | المطلوب | من يفعله |
|---|---|---|
| Q5-2 | تغيير `EMBEDDINGS_DRY_RUN` من `true` → `false` في Cloud Run | المالك — تغيير env فقط |
| Phase 2 | تشغيل `enable:phase2-tools` بـDB الإنتاج + اختبار محادثة حيّة تنتج طلباً | المالك — سكربت يدوي |

أمر Q5-2:
```bash
gcloud run services update khadamatak-staging \
  --region=me-central1 \
  --update-env-vars EMBEDDINGS_DRY_RUN=false
```

أمر Phase 2:
```bash
DATABASE_URL="<prod-url>" AGENT_ID="<uuid>" \
  corepack pnpm --filter @workspace/scripts run enable:phase2-tools
```

---

## Hotfix Lane — سجل الأعطال الإنتاجية

| الرمز | العطل | الحالة | Commit |
|---|---|---|---|
| PD-1 | الإرسال اليدوي لا يصل للعميل | ✅ محلول | (سابق) |
| PD-2 | رد الوكيل لا يظهر في الوارد | ✅ محلول | (سابق) |
| PD-3 | الوسائط الواردة لا تُحفظ | ✅ محلول | (سابق) |
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

## النطاق التالي: النطاق 6 — الموثوقية والتشغيل

يشمل: مراقبة + تنبيه + تقسيم outbox-worker + health checks + idling + نسخ Cloud Run.
