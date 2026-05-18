# Phase 5-Prep Report

## Scope

Phase 5-Prep prepared production wiring for AI model selection and Meta channel onboarding. No deployment, browser automation, production migration, or live outbound provider call was performed.

## Commit 1 — Vertex AI Model Selection

- Generation model locked: `gemini-2.5-flash`
- Embedding model locked: `text-embedding-005`
- Embedding dimension locked: `vector(768)`
- Region locked: `us-central1`
- Temperature default: `0.3`
- Max output tokens default: `2048`
- Migration prepared: `lib/db/drizzle/0014_embedding_dim_fix.sql`
- Architecture note created: `docs/architecture/AI_MODELS.md`
- Verification:
  - `corepack pnpm -r typecheck`: PASS
  - `corepack pnpm run build:prod`: PASS

## Existing Meta Support Before Commit 2

- Existing Embedded Signup was WhatsApp-focused.
- Existing start endpoint returned Meta OAuth URL for WhatsApp scopes.
- Existing callback could link one WhatsApp `channel_accounts` row when WABA, phone number ID, and token reference were available.
- Existing Meta service supported WhatsApp template send, text send, template submit, and status fetch.
- Existing webhook path verified Meta HMAC when `META_APP_SECRET` was configured and persisted raw webhook events.
- Existing outbox worker supported WhatsApp send events and DRY_RUN behavior.

## Commit 2 — Unified Meta Channels Prep

Prepared one Meta OAuth flow for:

- WhatsApp
- Instagram
- Messenger

New or extended backend paths:

- `GET /api/integrations/meta/embedded-signup/start`
  - Requests WhatsApp, Instagram, Messenger, and Page messaging scopes.
- `GET /api/integrations/meta/embedded-signup/callback`
  - Validates state.
  - Exchanges code when live credentials exist.
  - Discovers WABAs, Facebook Pages, and Instagram Business accounts.
  - Falls back to environment references in DRY_RUN/setup mode.
  - Redirects to `/integrations/meta/select-channels`.
- `GET /api/integrations/meta/channels/options`
  - Returns selectable Meta entities without token values.
- `POST /api/integrations/meta/channels`
  - Creates one `channel_accounts` row per selected WhatsApp, Instagram, or Messenger entity.
  - Stores token as encrypted/reference text in `credentials_secret_ref`.
  - Writes audit row per linked channel.
- `GET /api/integrations/meta/channels`
  - Lists connected Meta channels without exposing secrets.

Webhook dispatch now supports:

- `object='whatsapp_business_account'` -> WhatsApp handler
- `object='instagram'` -> Instagram messaging handler
- `object='page'` -> Messenger handler

Outbox worker now recognizes:

- `message.send.instagram.text`
- `message.send.messenger.text`

DRY_RUN behavior remains preserved for all three channels when `META_APP_SECRET`, runtime token, or live credentials are absent.

## UI Prep

- Added `MetaConnectChannelsPage` at `/integrations/meta/select-channels`.
- The page lets the operator choose:
  - WhatsApp phone numbers
  - Instagram Business accounts
  - Facebook Pages for Messenger
- Updated Integrations page to show connected Meta channels and a unified “ربط قنوات ميتا الإضافية” flow.
- No access token, app secret, or verify token is shown in the UI.

## Documentation

- Replaced WhatsApp-only architecture doc with:
  - `docs/architecture/META_CHANNELS.md`
- Documented:
  - Unified OAuth scopes
  - Channel selection flow
  - Webhook dispatch by Meta `object`
  - Payload examples for WhatsApp, Instagram, Messenger
  - DRY_RUN behavior
  - Known Meta messaging policy limits

## Environment Keys

Updated `.env.example` with documented Meta channel keys:

- `META_GRAPH_VERSION`
- `META_REDIRECT_URI`
- `META_OAUTH_STATE_SECRET`
- `META_DRY_RUN`
- `META_DISPLAY_PHONE_NUMBER`
- `META_VERIFIED_NAME`
- `META_FACEBOOK_PAGE_ID`
- `META_INSTAGRAM_BUSINESS_ID`
- `META_INSTAGRAM_USERNAME`
- `META_ACCESS_TOKEN`
- `META_ACCESS_TOKEN_SECRET_REF`
- `META_PAGE_ACCESS_TOKEN_SECRET_REF`

No values were added.

## Telegram

Telegram remains separate because it is not a Meta channel. It is intentionally not part of this unified Embedded Signup flow and should be added later only if a merchant requests it.

## Operator Still Needs

Before live production use, the operator must:

1. Create and configure a Meta App.
2. Request required scopes from Meta App Review.
3. Deploy the updated API, web, and worker services.
4. Configure `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, and channel token references in Cloud Run or Secret Manager.
5. Configure Meta webhook URLs in the Meta dashboard.
6. Run the Embedded Signup flow from the Integrations page.
7. Keep DRY_RUN on until a controlled live test is explicitly approved.

## Verification

- `corepack pnpm -r typecheck`: PASS
- `corepack pnpm run build:prod`: PASS
- `corepack pnpm --filter @workspace/scripts smoke:phase4`: PASS
- Smoke result: `PHASE4_SMOKE_PASS: mode=contract-dry-run checks=15 external_calls=0`

## Safety

- No deployment performed.
- No migrations executed.
- No browser automation used.
- No secrets printed.
- No access tokens stored in plain UI responses.
- No outbound provider call was made during verification.
