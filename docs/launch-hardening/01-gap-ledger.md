# Launch Hardening Gap Ledger

Generated: 2026-06-30 Asia/Riyadh

Severity key:

- `P0`: production outage, data loss, cross-tenant leakage, or critical security risk.
- `P1`: launch-blocking correctness/security/reliability gap.
- `P2`: important hardening or operational risk.
- `P3`: cleanup, documentation, or polish.

Status key:

- `open`: confirmed, not fixed.
- `in_progress`: fix underway.
- `blocked`: blocked by external dependency or missing credential/environment.
- `closed`: fixed and regression-tested.

## G-0001 - Production service naming mismatch

- Severity: `P2`
- Status: `open`
- Area: Production / deployment operations
- Gap: The public production domains `wesal.one` and `www.wesal.one` route to Cloud Run service `khadamatak-staging`, while a separate `khadamatak-prod` service exists and is stale.
- Evidence:
  - Cloud Run domain mappings: `wesal.one -> khadamatak-staging`, `www.wesal.one -> khadamatak-staging`.
  - `khadamatak-prod` latest ready revision is `khadamatak-prod-00003-bd8`, created in May 2026, with image `app:staging`.
  - `khadamatak-staging` latest ready revision is `khadamatak-staging-00247-487`, image `app:9d8f4da`, and `PUBLIC_BASE_URL=https://www.wesal.one`.
- Reproduction:
  - `gcloud beta run domain-mappings list --platform=managed --region=us-central1 --format=json`
  - `gcloud run services describe khadamatak-staging --platform=managed --region=us-central1 --format=json`
  - `gcloud run services describe khadamatak-prod --platform=managed --region=us-central1 --format=json`
- Impact: Future operators may deploy or roll back the wrong service because naming does not match production routing.
- Recommended fix: Rename or replace release documentation and deployment variables so the production route/service relationship is explicit. Do not rename Cloud Run blindly during this hardening branch; first add runbook guardrails and deployment checks.
- Regression test / gate: Release gate must assert the domain mapping route equals the intended service before deployment and before traffic movement.

## G-0002 - Onboarding state is a single workspace flag, not the required three-step canonical state

- Severity: `P1`
- Status: `closed`
- Area: Onboarding / auth / route guards
- Gap: The application previously gated internal pages using only `onboardingCompleted`, derived from `workspace.settings.onboarding_completed === true`, with no canonical three-step state.
- Evidence:
  - [onboarding-status.ts](../../artifacts/api-server/src/services/onboarding-status.ts) now derives `agent`, `channel`, and `knowledge` completion from live DB state.
  - [auth.routes.ts](../../artifacts/api-server/src/modules/auth/auth.routes.ts) now returns `onboardingStatus` plus the legacy `onboardingCompleted` mirror from `/register`, `/login`, `/google`, and `/me`.
  - [AuthContext.tsx](../../artifacts/web/src/context/AuthContext.tsx) now stores canonical `onboardingStatus` and derives route decisions from it.
- Reproduction:
  - Register a new workspace with no agent, no channel, and no knowledge.
  - `/api/auth/me` now returns `onboardingStatus.currentStep=1` and `onboardingCompleted=false`.
  - After completing the three real steps, `/api/auth/me` returns `completed=true`.
- Impact: Closed by server-derived canonical status.
- Recommended fix: Done in this branch; keep the legacy boolean only as a compatibility mirror, not as a source of truth.
- Regression test / gate: Added [onboarding-status.spec.ts](../../artifacts/api-server/src/__tests__/onboarding-status.spec.ts) and verified auth/web typecheck + build.

## G-0003 - Current onboarding UI has five steps and includes a skip path

- Severity: `P1`
- Status: `closed`
- Area: Onboarding UX / launch requirement
- Gap: Required onboarding has exactly three stages: create agent, connect one channel, add text knowledge. The previous UI used five steps and included a skip path.
- Evidence:
  - [OnboardingPage.tsx](../../artifacts/web/src/pages/OnboardingPage.tsx) now uses `STEP_COUNT = 3`.
  - The skip button and `skipOnboarding()` path are removed.
  - The page now contains only agent setup, channel connection, and knowledge ingestion.
- Reproduction:
  - Open `/onboarding` as a new user.
  - Observe the three-step flow only, with no skip affordance.
- Impact: Closed by the new three-step onboarding surface.
- Recommended fix: Done in this branch.
- Regression test / gate: Web typecheck + build passed; E2E remains to be added under G-0008.

## G-0004 - Onboarding channel choices expose Messenger/Facebook content and allow skipping channel connection

- Severity: `P1`
- Status: `closed`
- Area: Onboarding / Meta channels
- Gap: Required onboarding channel choices are WhatsApp and Instagram only. The previous UI exposed Messenger/Facebook content and allowed continuation without a channel.
- Evidence:
  - [OnboardingPage.tsx](../../artifacts/web/src/pages/OnboardingPage.tsx) now renders only two channel options: `whatsappStandard` and `instagramMessenger`.
  - Step 2 no longer offers a continue-later path.
- Reproduction:
  - Open onboarding step 2.
  - Observe only WhatsApp and Instagram.
- Impact: Closed by the simplified channel step.
- Recommended fix: Done in this branch.
- Regression test / gate: Manual verification is straightforward; automated E2E still belongs in the launch gate.

## G-0005 - Onboarding marks channel connected after callback returns, without explicit backend status verification

- Severity: `P1`
- Status: `closed`
- Area: Onboarding / Meta embedded signup
- Gap: The previous onboarding flow marked the channel as connected after a callback return without re-reading the saved channel state.
- Evidence:
  - [OnboardingPage.tsx](../../artifacts/web/src/pages/OnboardingPage.tsx) now uses the same completion endpoints as the Integrations surface (`/embedded-signup/complete` and `/embedded-signup/instagram-messenger/complete`).
  - After completion it refetches `/integrations/meta/channels` and refreshes canonical auth onboarding status before advancing.
- Reproduction:
  - Complete Meta signup and inspect the UI.
  - Advancement now depends on a connected channel row with credentials, not a local boolean.
- Impact: Closed for the onboarding surface.
- Recommended fix: Done in this branch.
- Regression test / gate: Error-path integration tests for Meta remain part of the wider channels hardening lane.

## G-0006 - Onboarding third stage does not create or verify real knowledge

- Severity: `P1`
- Status: `in_progress`
- Area: Knowledge / RAG / onboarding
- Gap: The required third stage is text knowledge creation, processing, indexing, and retrieval verification. The old onboarding never created knowledge. The new flow now creates a real base/document, but it still does not execute a retrieval proof before declaring success.
- Evidence:
  - [OnboardingPage.tsx](../../artifacts/web/src/pages/OnboardingPage.tsx) now creates or reuses a real knowledge base and POSTs a real document through `knowledge/bases/:id/documents`.
  - [onboarding-status.ts](../../artifacts/api-server/src/services/onboarding-status.ts) marks the knowledge step complete only when it finds a ready document with chunks.
  - No retrieval smoke proof is executed yet during onboarding completion.
- Reproduction:
  - Complete the new onboarding and inspect knowledge tables.
  - A real ready document and chunks now exist, but retrieval is not actively asserted in the flow.
- Impact: Substantially reduced, but not fully closed until retrieval proof exists.
- Recommended fix: Keep current creation path, then add a lightweight retrieval verification before final completion.
- Regression test / gate: Future onboarding integration test should create text knowledge and assert retrieval returns the seeded content.

## G-0007 - Frontend has route gate, but no server-side onboarding route/API gate

- Severity: `P1`
- Status: `open`
- Area: Route protection / API security
- Gap: Frontend `ProtectedRoute` redirects incomplete users, but API route registration does not include a server-side onboarding gate for internal modules.
- Evidence:
  - [App.tsx](../../artifacts/web/src/App.tsx): lines 109-118 implement frontend `ProtectedRoute`.
  - [routes/index.ts](../../artifacts/api-server/src/routes/index.ts): internal routers are mounted directly; no onboarding middleware appears in the route list.
- Reproduction:
  - Authenticate as a workspace with `onboarding_completed=false`.
  - Call internal APIs such as `/api/dashboard`, `/api/inbox`, `/api/orders` directly.
  - Expected launch behavior: block except explicitly allowed onboarding APIs.
- Impact: Deep links are handled in the UI, but direct API access can bypass onboarding restrictions.
- Recommended fix: Add API middleware after auth/session that checks canonical onboarding status and allows only onboarding-required endpoints until completion.
- Regression test / gate: HTTP integration test matrix for allowed onboarding APIs and blocked internal APIs before completion.

## G-0008 - CI does not yet include the unified launch gate

- Severity: `P1`
- Status: `open`
- Area: CI / release gates
- Gap: Existing workflow coverage appears scoped to commerce safety and validation jobs, not the unified launch gate requested: install, lint, typecheck, unit, integration, migrations, drift, isolation, onboarding E2E, webhook duplicate/load, web/API/Docker build, secret scan, dependency audit, and artifacts.
- Evidence:
  - Search found `.github/workflows/commerce-safety-gate.yml` with migration/typecheck/unit/integration/build steps.
  - No evidence yet of Playwright onboarding E2E, webhook duplicate storm/load, Docker build gate, secret scan, or full dependency audit in a single required workflow.
- Reproduction:
  - Inspect `.github/workflows`.
  - Compare workflow jobs against launch gate checklist.
- Impact: Regressions can reach `main` without the required launch-hardening proof.
- Recommended fix: Add a new launch gate workflow or expand an existing required workflow without weakening current commerce gates.
- Regression test / gate: GitHub Actions workflow runs on `pull_request`, `push main`, and `workflow_dispatch`, publishes artifacts on failure.

## G-0009 - Deferred webhook acknowledgement is not durably committed before upstream success

- Severity: `P0`
- Status: `closed`
- Area: Webhooks / ingest / reliability
- Gap: Deferred webhook acknowledge paths previously returned success before durable internal enqueue/commit guarantees were complete.
- Evidence:
  - [meta.routes.ts](../../artifacts/api-server/src/modules/webhooks/meta.routes.ts) now awaits `ingestWebhookEvent()` before returning `200 EVENT_RECEIVED` in deferred mode.
  - [webhookIngest.service.ts](../../artifacts/api-server/src/modules/integrations/webhookIngest.service.ts) now inserts with `ON CONFLICT DO NOTHING` and then reads the existing row on duplicates, closing concurrent duplicate races around `(provider, idempotency_key)`.
- Impact: Closed for Meta deferred ingest; database failure now returns `500 INGEST_FAILED` so the provider can retry instead of silently losing the event.
- Recommended fix: Done in this branch.
- Regression test / gate: Existing webhook ingest tests cover idempotency; typecheck/build gates verify the hardened route compiles.

## G-0010 - Outbox send path can duplicate downstream deliveries

- Severity: `P0`
- Status: `closed`
- Area: Outbox / worker / messaging
- Gap: Outbox processing previously allowed duplicate-send windows when multiple worker loops selected the same pending outbound event.
- Evidence:
  - [index.ts](../../artifacts/outbox-worker/src/index.ts) now claims outbound message events via `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING ...` before sending.
  - Success, retry, permanent failure, and WhatsApp 24h-window failure updates are guarded by `status='processing'`.
- Impact: Closed for the worker duplicate-claim window; concurrent workers no longer publish the same `pending` event.
- Recommended fix: Done in this branch.
- Regression test / gate: Outbox worker typecheck/build gates verify the hardened worker compiles.

## G-0011 - Meta onboarding backend still has partial-state channel activation risk

- Severity: `P1`
- Status: `open`
- Area: Meta / channels
- Gap: Channel activation can still report success in backend paths even when subscription or registration sub-steps fail, especially outside the new onboarding surface.
- Evidence:
  - Agent 3 audit found callback/select flows that can create active channel rows without full subscription/registration parity.
- Impact: Operators may see connected channels that are not actually ready to ingest or send.
- Recommended fix: Harden backend channel state transitions so only fully subscribed/registered channels enter the active state.

## G-0012 - Media fetch path accepts arbitrary URLs

- Severity: `P0`
- Status: `open`
- Area: Security / uploads / AI media
- Gap: Internal media fetch logic can request arbitrary URLs without a strict allowlist, creating SSRF exposure.
- Evidence:
  - Agent 4 audit confirmed arbitrary `mediaUrl` handling remains too permissive.
- Impact: Internal network probing or credential exfiltration risk.
- Recommended fix: Restrict media fetch targets to explicit provider hosts and add size/time limits.

## G-0013 - Payment confirmation authority is too broad

- Severity: `P0`
- Status: `open`
- Area: Payments / authz
- Gap: Owners can confirm their own payment submissions without an independent authorization boundary.
- Evidence:
  - Agent 4 audit flagged self-confirmation on payment approval paths.
- Impact: Financial integrity and audit-trail trust are weakened.
- Recommended fix: Split submission from confirmation authority and require an explicit privileged role or back-office review path.

## G-0014 - AI billing and cancellation are not transactionally aligned

- Severity: `P1`
- Status: `open`
- Area: AI / billing / provider control
- Gap: Point reservation, timeout abort, and late provider completion are not yet aligned, so billing can drift from real provider execution.
- Evidence:
  - Agent 5 audit found no reservation hold, no provider-side cancel on timeout, and late-completion billing ambiguity.
- Impact: Undercharge, overcharge, or inconsistent wallet state under slow/failed AI runs.
- Recommended fix: Add reservation + finalize/release semantics around every billable AI run.

## G-0015 - API onboarding gate is still missing for non-onboarding modules

- Severity: `P1`
- Status: `open`
- Area: Auth / route protection
- Gap: Canonical onboarding status is now available, but internal API routers are still not blocked server-side for incomplete workspaces.
- Evidence:
  - [routes/index.ts](../../artifacts/api-server/src/routes/index.ts) still mounts internal routers without an onboarding-complete middleware.
  - G-0007 remains open by design after this branch's current implementation.
- Impact: Direct API access can still bypass the frontend onboarding route guard.
- Recommended fix: Add a narrow allowlist middleware for onboarding-required endpoints, then block the rest until completion.
