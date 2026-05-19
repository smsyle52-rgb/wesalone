# Meta Wiring Ready

## Summary
- Test App ID: `956632443920182`
- Webhook verify handler: present at `GET /api/webhooks/meta`
- OAuth callback URL: confirmed as `https://khadamatak-staging-1067617934225.us-central1.run.app/api/integrations/meta/embedded-signup/callback`
- OAuth scopes: confirmed for WhatsApp, Instagram, and Messenger
- Graph API version: `v21.0`
- DRY_RUN behavior: preserved when Meta credentials are absent
- Secrets: no Meta secrets or tokens are committed

## Implemented
- Meta test app setup guide created at `docs/deploy/META_TEST_APP_SETUP.md`.
- Meta webhook verification challenge is handled with `META_VERIFY_TOKEN`.
- Integrations page shows Meta channel status for WhatsApp, Instagram, and Messenger.
- Connected channels can be disabled without deleting history.
- Inbox shows a banner when no Meta channels are connected.

## Operator Next Steps
1. Configure Meta Test App `956632443920182` in Meta Developer Console.
2. Set `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_REDIRECT_URI`, and `META_DRY_RUN=false` in Cloud Run.
3. Configure the Meta webhook callback URL and verify token.
4. Login to staging, open integrations, and run Embedded Signup.
5. Select the connected test channel and send a test inbound message.

See `docs/deploy/META_TEST_APP_SETUP.md` for the full runbook.
