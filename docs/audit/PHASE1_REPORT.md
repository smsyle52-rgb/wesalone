# Phase 1 Consolidated Report

## الحالة العامة

Phase 1 توقف أثناء Phase 1F عند فحص `typecheck` الشامل.

تم تنفيذ المراحل 1A إلى 1E وعمل commit لكل مرحلة بنجاح. لم يتم عمل commit لمرحلة 1F لأن التحقق فشل قبل اكتمالها.

## ملخص المراحل والـ commits

| Phase | Commit | الحالة | ملخص |
| --- | --- | --- | --- |
| Phase 1A | `61c4f41` | تم | تجهيز `.env.example`، استبعاد `mockup-sandbox` من صورة الإنتاج، وإضافة guard يمنع `db:push` في production. |
| Phase 1B | `06b8d33` | تم | إضافة hardening للـ Express: Helmet، rate limiting، request id، pino logging، CORS tighter، HMAC للـ webhooks، وidempotency middleware. |
| Phase 1C | `d8bdbf2` | تم | إضافة migration للفهارس الحرجة وجدول `idempotency_keys` مع عكسها في Drizzle schema. |
| Phase 1D | `dfaa1fa` | تم | إضافة `outbox-worker` كـ workspace جديد مع Dockerfile وCloud Build config وتوثيق التشغيل. |
| Phase 1E | `bb7978a` | تم | إضافة i18n scaffold للواجهة وترجمة sidebar وPageHeader فقط. |
| Phase 1F | لا يوجد | فشل | توقف عند `corepack pnpm -r typecheck` بسبب نقص `scripts/tsconfig.json`. |

## فشل Phase 1F

الأمر الذي فشل:

```bash
corepack pnpm -r typecheck
```

آخر نتيجة مهمة:

```text
Scope: 9 of 10 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck: error TS5058: The specified path does not exist: 'tsconfig.json'.
scripts typecheck: Failed
@workspace/scripts@0.0.0 typecheck: `tsc -p tsconfig.json --noEmit`
Exit status 1
```

السبب المباشر:

`scripts/package.json` يحتوي script باسم `typecheck` يشغّل:

```bash
tsc -p tsconfig.json --noEmit
```

لكن الملف المطلوب `scripts/tsconfig.json` غير موجود في الريبو.

## ما لم يتم بسبب الفشل

- لم يتم تشغيل `corepack pnpm -r build` بعد الفشل.
- لم يتم تشغيل lint.
- لم يتم عمل commit لمرحلة Phase 1F.
- لم يتم إعلان `PHASE1_DONE`.

## الجداول والفهارس الجديدة

الجداول:

- `idempotency_keys`

الفهارس:

- فهارس tenant scoping للـ contacts, conversations, messages, tickets, tasks, followups, orders, payments, audit logs.
- فهارس outbox:
  - `idx_outbox_events_status`
  - `idx_outbox_msgs_status`
- فهرس contact channels:
  - `idx_contact_channels_normalized`
- فهرس انتهاء idempotency:
  - `idx_idempotency_expires`

## الاعتماديات الجديدة

API:

- `helmet`

Outbox worker:

- `pg`
- `drizzle-orm`
- `pino`
- `tsx`
- `esbuild`
- `@types/node`
- `@types/pg`

Web i18n:

- `i18next`
- `react-i18next`
- `i18next-browser-languagedetector`

## حالة الأمان

- لم يتم طباعة أسرار.
- لم يتم تشغيل migrations على production.
- لم يتم استخدام `db:push`.
- لم يتم حذف بيانات.
- لم يتم إضافة outbound WhatsApp live أو Payment Gateway live.

## المطلوب قبل إغلاق Phase 1

1. تحديد سياسة workspace `scripts`:
   - إما إضافة `scripts/tsconfig.json`.
   - أو تعديل/إزالة script `typecheck` إذا كانت scripts ليست جزءاً من typecheck الإنتاجي.
2. إعادة تشغيل:

```bash
corepack pnpm -r typecheck
```

3. عند نجاح typecheck، تشغيل:

```bash
corepack pnpm -r build
```

4. بعد نجاح الفحوصات، إكمال Phase 1F وعمل commit:

```text
chore: phase1 cleanup + report
```

## أسئلة معمارية مفتوحة

- هل package `@workspace/scripts` يجب أن يكون package TypeScript رسمي له `tsconfig.json`؟
- هل `artifacts/mockup-sandbox` يجب أن يدخل في `pnpm -r typecheck/build` أم يُستبعد من CI الإنتاجي؟
- هل build النهائي يجب أن يُعتمد فقط داخل Linux/Cloud Build لتجنب مشاكل Rollup optional dependency على Windows؟

## Phase 1 Resume Attempt — Blocked

- Date: 2026-05-17T17:08:00Z
- Step attempted: Step 1 — unblock `scripts` workspace
- Change prepared but not committed: added `scripts/tsconfig.json`
- typecheck: PASS
- build: FAIL

Command:

```bash
corepack pnpm -r build
```

Failure:

```text
artifacts/mockup-sandbox build$ vite build
Error: Cannot find module @rollup/rollup-win32-x64-msvc.
@workspace/mockup-sandbox@2.0.0 build: `vite build`
Exit status 1
```

Assessment:

The blocker is unrelated to the missing `scripts/tsconfig.json`. It is the known Rollup native optional dependency issue on Windows, triggered by the Vite build in `artifacts/mockup-sandbox`.

Per instruction, no aggressive fix was applied because this is not a Phase 1 code regression in Helmet, pino, Drizzle schema, or i18n. No commit was created for Step 1 because the required build did not pass.

## Phase 1 Close Attempt — Blocked at Commit 2 Verification

- Date: 2026-05-17T17:18:00Z
- Commit 1 status: PASS and committed as `fix(scripts): add tsconfig.json to unblock pnpm -r typecheck`
- Commit 2 status: prepared but not committed
- `corepack pnpm -r typecheck`: PASS
- `corepack pnpm run build:prod`: FAIL

Command:

```bash
corepack pnpm run build:prod
```

Failure:

```text
artifacts/web build$ vite build --config vite.config.ts
Error: Cannot find module @rollup/rollup-win32-x64-msvc.
@workspace/web@0.0.0 build: `vite build --config vite.config.ts`
Exit status 1
```

Assessment:

`build:prod` successfully excluded `@workspace/mockup-sandbox`, but the production web package still uses Vite/Rollup and hits the same Windows native optional dependency issue. Because this failure is now in `@workspace/web`, not the design-only `mockup-sandbox`, the close procedure stopped per instruction.

Prepared but uncommitted changes:

- `package.json`: added `build:prod`
- `docs/architecture/BUILD.md`: documented production build commands

No Phase 1F cleanup commit was created.

## Phase 1 — Closure

- Date: 2026-05-17T17:38:34.4339765Z
- typecheck: PASS
- build:prod (Linux/CI authoritative): PASS
- Non-web packages build: PASS
- lint: SKIPPED
- Providers removed: none needed; `shopify`, `tiktok`, `tiktok_shop`, and `TikTokShop` were absent from production integration registries, UI provider lists, dropdowns, switch cases, and icon imports.
- AI public-copy replacements: 0
- pnpm cross-platform: enabled via `supportedArchitectures` (linux, darwin, win32 × x64, arm64)
- Total new dependencies installed across Phase 1: 11
- New tables: `idempotency_keys`
- New indexes: 18
- New Cloud Run service ready to deploy: `khadamatak-outbox-worker`
- Open items deferred to Phase 2:
  - Templates module (WhatsApp template management + Meta sync)
  - Broadcasts module
  - Automations module (trigger / condition / action engine)
  - Bots & Agents page upgrade (Gabster pattern)
  - Sidebar reorganization (Gabster grouping)
  - Full i18n migration of remaining hardcoded strings
  - Web Chat widget runtime
  - Meta Embedded Signup live wiring

## Locked Architectural Decisions (Phase 1)

- `@workspace/scripts` is a first-class TypeScript package with its own tsconfig.
- `artifacts/mockup-sandbox` is in `pnpm -r typecheck` (regression catch) but excluded from `build:prod`.
- Production build authority: Cloud Build on Linux. Local builds are advisory.
- Canonical production build command: `pnpm run build:prod`.
- pnpm `supportedArchitectures` declared so the lockfile covers linux + darwin + win32 native bins.
- Outbox worker: separate Cloud Run service, min-instances=1, CPU always-allocated.
- Webhook ingestion REQUIRES HMAC for Meta; other providers logged as unverified.
- Idempotency keys scoped initially to `/api/payments/*`, `/api/orders/*`, `/api/integrations/outbox/*`.
- Default UI locale: ar (RTL); en is admin/dev fallback (LTR).
- Shopify and TikTok permanently out of scope.
- "AI" / "ذكاء اصطناعي" removed from public-facing copy; internal labels retained.
