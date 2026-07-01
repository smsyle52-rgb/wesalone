# Production Parity - Wave 0

Generated: 2026-06-30 Asia/Riyadh

## Scope

This document proves the currently deployed production version before any launch-hardening fixes. Production was treated as read-only. No production database writes, load tests, traffic changes, or deploy commands were executed during this parity check.

## Local Repository

- Repository: `C:\Users\USERW\Documents\khadamatak-github-publish-20260507163016`
- GitHub: `smsyle52-rgb/khadamatak`
- Original working tree branch: `fix/restore-store`
- Original working tree HEAD: `99abf1054838c8025ef6e84126b3a84422282958`
- Original working tree status at start:
  - `M artifacts/api-server/src/modules/integrations/integrations.routes.ts`
  - `M artifacts/web/src/pages/IntegrationsPage.tsx`
  - `M artifacts/web/src/pages/ProductsPage.tsx`
- Protection action: created an independent worktree instead of modifying the dirty working tree.

## Hardening Worktree

- Worktree path: `C:\Users\USERW\Documents\khadamatak-launch-hardening`
- Branch: `hardening/production-launch-onboarding-stability`
- Base commit: `9d8f4da1599a0c152a879e0736da52a61d02a0f0`
- Base subject: `Merge branch 'fix/mobile-spacing-pwa-app-experience'`
- Worktree status after creation: clean

## Git Parity

- `origin/main`: `9d8f4da1599a0c152a879e0736da52a61d02a0f0`
- Deployed web/API service image tag: `app:9d8f4da`
- Deployed worker image tag: `outbox-worker:9d8f4da`
- Cloud Build source commit: `9d8f4da1599a0c152a879e0736da52a61d02a0f0`
- Result: production runtime commit matches `origin/main`.

Note: during the first Cloud Run list call, `khadamatak-staging` still showed `app:99abf10`. A later direct service describe showed generation 247 deployed with `app:9d8f4da`; Cloud Build confirms the later deployment succeeded.

## Production Routing

Cloud Run domain mappings in `us-central1`:

- `wesal.one` -> route `khadamatak-staging`
- `www.wesal.one` -> route `khadamatak-staging`

Operational naming gap:

- The public production domain is served by a Cloud Run service named `khadamatak-staging`.
- There is also a `khadamatak-prod` service, but it is old and is not the route for `wesal.one`.
- This is a release-risk naming mismatch and must be tracked in the gap ledger before future deploy automation changes.

## Web/API Cloud Run Service

- Project: `khadamatk-auth`
- Region: `us-central1`
- Service: `khadamatak-staging`
- Current ready revision: `khadamatak-staging-00247-487`
- URL: `https://khadamatak-staging-owkaa4bleq-uc.a.run.app`
- Domain route: `wesal.one`, `www.wesal.one`
- Image: `us-central1-docker.pkg.dev/khadamatk-auth/khadamatak/app:9d8f4da`
- Image digest: `sha256:ef1f11884417f08e052d21d44927a8d364ae04102034506efd855033f9b22967`
- Fully qualified digest: `us-central1-docker.pkg.dev/khadamatk-auth/khadamatak/app@sha256:ef1f11884417f08e052d21d44927a8d364ae04102034506efd855033f9b22967`
- Cloud SQL instance: `khadamatk-auth:us-central1:khadamatak-prod`
- Min instances: `1`
- Max instances: `1`
- Concurrency: `80`
- Timeout: `300s`
- Service account: `1067617934225-compute@developer.gserviceaccount.com`
- Traffic: `100%` to latest ready revision
- Container port: `8080`

Non-secret environment values observed:

- `NODE_ENV=production`
- `SERVE_STATIC=true`
- `AI_PROVIDER=vertex`
- `VERTEX_PROJECT_ID=khadamatk-auth`
- `VERTEX_LOCATION=us-central1`
- `VERTEX_MODEL=gemini-2.5-flash`
- `AI_MAX_OUTPUT_TOKENS=2048`
- `AI_TEMPERATURE=0.2`
- `EMBEDDINGS_DRY_RUN=false`
- `MODEL_TEXT_NORMAL=gemini-3-flash-preview`
- `MODEL_TEXT_HARD=gemini-3-flash-preview`
- `MODEL_VISION_NORMAL=gemini-3-flash-preview`
- `MODEL_VISION_HARD=gemini-3-flash-preview`
- `MODEL_VOICE_NORMAL=gemini-3-flash-preview`
- `MODEL_VOICE_HARD=gemini-3-flash-preview`
- `PUBLIC_BASE_URL=https://www.wesal.one`
- `ALLOWED_ORIGINS=https://www.wesal.one,https://wesal.one,https://khadamatak-staging-1067617934225.us-central1.run.app`
- `META_APP_ID=1437258534807702`
- `META_GRAPH_VERSION=v22.0`
- `META_WHATSAPP_STANDARD_CONFIG_ID=845347748296104`
- `META_WHATSAPP_COEXISTENCE_CONFIG_ID=1375409704475660`
- `META_INSTAGRAM_MESSENGER_CONFIG_ID=2181802019272074`
- `META_FACEBOOK_CONTENT_CONFIG_ID=27444093488614246`
- `UPLOADS_BUCKET=khadamatak-auth-uploads`

Secret-backed environment variables were observed only by secret reference names, not values:

- `DATABASE_URL`
- `SESSION_SECRET`
- `META_APP_SECRET`
- `META_SYSTEM_USER_TOKEN`
- `META_WEBHOOK_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `INTERNAL_SECRET`
- `RESEND_API_KEY`

## Outbox Worker Cloud Run Service

- Project: `khadamatk-auth`
- Region: `us-central1`
- Service: `khadamatak-outbox-worker`
- Current ready revision: `khadamatak-outbox-worker-00132-wqr`
- URL: `https://khadamatak-outbox-worker-owkaa4bleq-uc.a.run.app`
- Image: `us-central1-docker.pkg.dev/khadamatk-auth/khadamatak/outbox-worker:9d8f4da`
- Image digest: `sha256:9228b7f040959359c2c45dce490f991d5a068a293d0fe87594b1bd4e90831f0f`
- Fully qualified digest: `us-central1-docker.pkg.dev/khadamatk-auth/khadamatak/outbox-worker@sha256:9228b7f040959359c2c45dce490f991d5a068a293d0fe87594b1bd4e90831f0f`
- Cloud SQL instance: `khadamatk-auth:us-central1:khadamatak-prod`
- Min instances: `1`
- Max instances: `1`
- Concurrency: `80`
- Timeout: `300s`
- CPU throttling: `false`
- Service account: `1067617934225-compute@developer.gserviceaccount.com`
- Traffic: `100%` to latest ready revision

Non-secret environment values observed:

- `NODE_ENV=production`
- `API_SERVER_URL=https://khadamatak-staging-1067617934225.us-central1.run.app`
- `AI_PROVIDER=vertex`
- `VERTEX_PROJECT_ID=khadamatk-auth`
- `VERTEX_LOCATION=us-central1`
- `VERTEX_MODEL=gemini-2.5-flash`
- `AI_MAX_OUTPUT_TOKENS=2048`
- `AI_TEMPERATURE=0.2`

Secret-backed environment variables were observed only by secret reference names, not values:

- `DATABASE_URL`
- `SESSION_SECRET`
- `META_SYSTEM_USER_TOKEN`
- `META_WEBHOOK_SECRET`
- `INTERNAL_SECRET`

## Cloud Build Evidence

- Build ID: `bc4a3d05-0279-475e-98de-e2fcc4a844c9`
- Status: `SUCCESS`
- Trigger: `khadamatak-staging`
- Trigger ID: `f93d1bfd-6763-445d-ae77-f6fb6579b29e`
- Source: `https://github.com/smsyle52-rgb/khadamatak.git`
- Source revision: `9d8f4da1599a0c152a879e0736da52a61d02a0f0`
- Image pushed: `us-central1-docker.pkg.dev/khadamatk-auth/khadamatak/app:9d8f4da`
- Image digest: `sha256:ef1f11884417f08e052d21d44927a8d364ae04102034506efd855033f9b22967`
- Build log: `https://console.cloud.google.com/cloud-build/builds/bc4a3d05-0279-475e-98de-e2fcc4a844c9?project=1067617934225`
- Build steps succeeded:
  - `build-image`
  - `push-image`
  - `enable-vertex-ai`
  - `migrate-database`
  - `verify-migration`
  - `deploy-staging`

## PR / Branch Comparison Inputs

Remote branches inspected after `git fetch --all --prune`:

- `origin/main` -> `9d8f4da`
- `origin/fix/mobile-spacing-pwa-app-experience` -> `1f07487`
- `origin/feat/commerce-inventory-orders-payments` -> `f75d2a7`
- `origin/fix/wesal-marketing-auth-design-match` -> `168e5d9`
- `origin/feat/whatsapp-settings-gap-port` -> `66df716`
- `origin/feat/wesal-marketing-auth-design` -> `23a6c86`
- additional recent hardening/chatwoot/whatsapp branches exist and will be considered during gap review.

PR numbers requested for comparison: `#1`, `#4`, `#5`, `#7`, `#8`.

PR metadata retrieved:

- PR #1 `fix(agent): structured phase 2 tool calls`
  - State: open draft, not merged
  - Base: `main`
  - Head: `fix/phase2-structured-tool-calls` at `f311a846332f5c88c1554464de5507a40d4707b4`
  - Mergeable: false
  - URL: `https://github.com/smsyle52-rgb/khadamatak/pull/1`
- PR #4 `Validate WhatsApp Business Profile CI scope`
  - State: open draft, not merged
  - Base: `feat/whatsapp-profile-status`
  - Head: `chore/whatsapp-validation-ci` at `6715cd226b6694571fdeec7aa7639f18d2ae4f5c`
  - Mergeable: true
  - URL: `https://github.com/smsyle52-rgb/khadamatak/pull/4`
- PR #5 `WIP: canonical ledger drift audit`
  - State: open draft, not merged
  - Base: `main`
  - Head: `chore/canonical-ledger-audit-ci` at `2340388ef9dfd1f5ede4220f26363d2127f9663f`
  - Mergeable: false
  - URL: `https://github.com/smsyle52-rgb/khadamatak/pull/5`
- PR #7 `fix(web): match Wesal marketing and auth source designs`
  - State: open draft, not merged
  - Base: `main`
  - Head: `fix/wesal-marketing-auth-design-match` at `168e5d9f03b5ce116161507bafc7255dfdede244`
  - Mergeable: false
  - URL: `https://github.com/smsyle52-rgb/khadamatak/pull/7`
- PR #8 `fix(web): overhaul mobile layout and installed PWA experience`
  - State: closed, merged
  - Base: `main`
  - Head: `fix/mobile-spacing-pwa-app-experience` at `1f0748776d7ae42182dd7d65ad937f70974a75bf`
  - Merge commit: `9d8f4da1599a0c152a879e0736da52a61d02a0f0`
  - URL: `https://github.com/smsyle52-rgb/khadamatak/pull/8`

Only PR #8 is included in the proven production commit. PRs #1, #4, #5, and #7 are still open drafts and must not be treated as production behavior.

## Phase 0 Result

Production commit is proven:

`9d8f4da1599a0c152a879e0736da52a61d02a0f0`

The hardening branch was created from that exact commit in an independent worktree:

`hardening/production-launch-onboarding-stability`

No production mutation was performed during this phase.
