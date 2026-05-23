# Meta Go-Live Guide — Wesal One

This guide switches Wesal One from a Meta test app to the approved production Meta app using configuration only. No code change is required.

## Required Cloud Run Environment

Set these values for the API service and any worker that sends or syncs Meta data:

- `PUBLIC_BASE_URL=https://<your-domain>`
- `META_APP_ID=<approved Meta app id>`
- `META_APP_SECRET=<Secret Manager reference>`
- `META_VERIFY_TOKEN=<operator-generated verify token>`
- `META_GRAPH_VERSION=<approved Graph API version, for example v21.0>`
- `META_REDIRECT_URI=https://<your-domain>/api/integrations/meta/embedded-signup/callback`
- `META_DRY_RUN=false`

Optional live send/sync values:

- `META_SYSTEM_USER_TOKEN=<Secret Manager reference or runtime secret>`
- `META_ACCESS_TOKEN=<temporary/operator token only if needed>`
- `META_ACCESS_TOKEN_SECRET_REF=<Secret Manager secret name for user token references>`
- `META_PAGE_ACCESS_TOKEN_SECRET_REF=<Secret Manager secret name for page token references>`
- `META_PHONE_NUMBER_ID=<fallback only>`
- `META_WABA_ID=<fallback only>`
- `META_FACEBOOK_PAGE_ID=<fallback only>`
- `META_INSTAGRAM_BUSINESS_ID=<fallback only>`
- `META_CATALOG_ID=<fallback only>`
- `META_AD_ACCOUNT_ID=<fallback only>`

## Switching From Test App to Production App

1. Create or confirm the approved Wesal One Meta app in Meta Developer Console.
2. Store the production app secret in Secret Manager. Do not paste it into logs, code, docs, or tickets.
3. Update Cloud Run:

```bash
gcloud run services update khadamatak-staging \
  --project=khadamatk-auth \
  --region=us-central1 \
  --update-env-vars="PUBLIC_BASE_URL=https://<your-domain>,META_APP_ID=<prod-app-id>,META_GRAPH_VERSION=<graph-version>,META_REDIRECT_URI=https://<your-domain>/api/integrations/meta/embedded-signup/callback,META_VERIFY_TOKEN=<verify-token>,META_DRY_RUN=false" \
  --update-secrets="META_APP_SECRET=<prod-secret-name>:latest"
```

4. Update the worker with the same `META_GRAPH_VERSION`, `META_DRY_RUN=false`, and token secret values if it is deployed separately.
5. In Meta Developer Console, set:

- OAuth Redirect URI: `https://<your-domain>/api/integrations/meta/embedded-signup/callback`
- Webhook Callback URL: `https://<your-domain>/api/webhooks/meta`
- Verify Token: exact value of `META_VERIFY_TOKEN`

6. Subscribe the webhook to:

- WhatsApp: `messages`, `message_deliveries`, `message_reads`
- Messenger: messages and messaging postbacks/events approved for the app
- Instagram: messaging events approved for the app

7. Re-verify webhook. Expected challenge response: HTTP 200 with the exact `hub.challenge`.
8. Run Embedded Signup from `/integrations`.
9. Select WhatsApp, Instagram, Messenger, catalogs, and ad accounts as applicable.
10. Send a real inbound test message from a permitted number.
11. Confirm:

- Contact created or matched.
- Conversation created or matched.
- Message inserted once.
- Domain event `message.received` exists.
- Agent draft reply can be generated.
- Outbox remains DRY_RUN=false only after verifying credentials.

## Rollback

If live traffic fails:

```bash
gcloud run services update khadamatak-staging \
  --project=khadamatk-auth \
  --region=us-central1 \
  --update-env-vars="META_DRY_RUN=true"
```

Then inspect Cloud Logging for webhook failures, signature failures, and outbox dead letters before enabling live again.

## Safety Guarantees

- Switching Meta apps is controlled by environment variables.
- Missing `META_APP_SECRET` or `META_DRY_RUN=true` keeps external Meta calls simulated.
- Missing `META_GRAPH_VERSION` blocks live Meta Graph calls instead of silently choosing a code default.
- Existing channel rows and catalog data are preserved.
