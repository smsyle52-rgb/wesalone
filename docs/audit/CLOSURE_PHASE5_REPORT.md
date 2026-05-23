# Closure Phase 5 Report — Meta Go-Live Readiness

Date: 2026-05-23

## Executive Summary

Meta integration is now prepared so that moving from the test Meta app to the approved Wesal One production app is a Cloud Run configuration switch, not a code change. DRY_RUN remains preserved for safe staging and local operation.

## Meta Configuration State

The live Meta code paths are environment-driven:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `META_GRAPH_VERSION`
- `META_REDIRECT_URI`
- `PUBLIC_BASE_URL`
- `META_DRY_RUN`
- runtime token references such as `META_SYSTEM_USER_TOKEN`, `META_ACCESS_TOKEN_SECRET_REF`, and `META_PAGE_ACCESS_TOKEN_SECRET_REF`

The code no longer silently falls back to a hardcoded Meta Graph API version for live calls. If `META_GRAPH_VERSION` is missing, live OAuth/Graph calls fail clearly instead of picking a code default.

## What Activates on Meta App Approval

After Meta App Review approval, the operator can activate live behavior by setting:

- production app id and secret
- production verify token
- approved Graph API version
- production OAuth redirect URI
- `META_DRY_RUN=false`
- live system user/page tokens where required

No source code change is required.

## Inbound Pipeline Verification

The inbound pipeline has been hardened and covered by the smoke test:

1. HMAC signature input is deterministic and compatible with Meta's `x-hub-signature-256`.
2. Webhook payload parses through the Meta-shaped message structure.
3. `phone_number_id` maps to the correct active `channel_accounts` row through `provider_config`.
4. Contact and contact channel are found or created.
5. Conversation is found or created.
6. Messages are inserted once by `provider_message_id`.
7. Domain event `message.received` is published.
8. Message types covered:
   - text
   - image
   - voice
   - location
   - document
   - unknown custom type
9. Location messages update contact city/location note.
10. Status updates only increment when a matching message is updated.
11. Duplicate payloads do not create duplicate messages.

## Catalog Live Sync Verification

Catalog, posts, and ads sync now verifies the live Meta API shape:

- Commerce Catalog:
  `/{catalog_id}/products?fields=id,name,description,price,currency,availability,inventory,image_url,url,brand,category`
- Page Posts:
  `/{page_id}/posts?fields=id,message,created_time,permalink_url,attachments,type`
- Ads:
  `/{ad_account_id}/ads?fields=id,name,status,objective,creative{body,image_url,object_story_spec},start_time,end_time`

Resilience behavior:

- DRY_RUN still generates safe sample data when `META_DRY_RUN=true` or `META_APP_SECRET` is absent.
- Live mode without a usable token fails clearly with `Meta catalog access token is not configured`.
- Failed sync marks the source as failed and records a sync run.
- Existing products/posts/ads are not deleted by a failed sync.
- Products that sync successfully are fed into knowledge chunks so the agent can retrieve them.
- Active ads and recent posts enter the agent context through `loadCatalogAgentContext`.

## Go-Live Checklist

Follow [docs/deploy/META_GOLIVE.md](../deploy/META_GOLIVE.md):

1. Store production Meta app secret in Secret Manager.
2. Set Cloud Run env vars for `PUBLIC_BASE_URL`, `META_APP_ID`, `META_GRAPH_VERSION`, `META_REDIRECT_URI`, `META_VERIFY_TOKEN`, and `META_DRY_RUN=false`.
3. Attach `META_APP_SECRET` from Secret Manager.
4. Configure Meta OAuth Redirect URI:
   `https://<your-domain>/api/integrations/meta/embedded-signup/callback`
5. Configure Meta Webhook Callback URL:
   `https://<your-domain>/api/webhooks/meta`
6. Subscribe WhatsApp fields: `messages`, `message_deliveries`, `message_reads`.
7. Subscribe Instagram/Messenger message events approved for the app.
8. Re-run webhook verify challenge.
9. Complete Embedded Signup from `/integrations`.
10. Send a real inbound test message and confirm it appears in `/inbox`.
11. Confirm agent draft reply works before inviting customers.

## Remaining External Dependency

The only remaining go-live dependency is Meta App Review approval for the requested messaging, catalog, and ads scopes. Until approval, keep live customer traffic in DRY_RUN or limited test mode.

## Verification

- `corepack pnpm --filter @workspace/scripts smoke:phase4`: PASS
- `corepack pnpm -r typecheck`: PASS
- `corepack pnpm run build:prod`: PASS

## Decision

PASS — Meta wiring is ready for app approval and production activation through configuration only.
