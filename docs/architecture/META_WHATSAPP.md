# Meta WhatsApp Integration

Phase 3 wires the platform to Meta WhatsApp Cloud API while keeping development safe by default.

## Environment

Required for live mode:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `META_GRAPH_VERSION`
- `META_WABA_ID`
- `META_PHONE_NUMBER_ID`
- `META_ACCESS_TOKEN_SECRET_REF` or a runtime token environment managed outside the repo

Optional:

- `META_DRY_RUN=true`
- `META_SYSTEM_USER_TOKEN`
- `META_ACCESS_TOKEN`

No token or app secret is committed, logged, or returned to the UI.

## DRY_RUN

When `META_APP_SECRET`, access token, WABA ID, or phone number ID are missing, send and template submission code returns synthetic success and logs `DRY_RUN`.
This keeps broadcasts, automations, and template flows testable without outbound provider calls.

## Embedded Signup

`GET /api/integrations/meta/embedded-signup/start` creates a CSRF state in the session and returns a Meta OAuth URL.

`GET /api/integrations/meta/embedded-signup/callback` validates state and links a WhatsApp `channel_accounts` row only when WABA ID, phone number ID, and a Secret Manager token reference are available.
Production deployments must store Meta tokens in Google Secret Manager and keep only the secret reference in `channel_accounts.credentials_secret_ref`.

## Webhooks

Generic webhook ingestion records the raw payload first.
For Meta WhatsApp payloads, the handler:

- resolves the linked channel account by `phone_number_id`
- creates or finds the contact and WhatsApp contact channel
- creates or reuses an open conversation
- inserts inbound messages idempotently by `provider_message_id`
- publishes `message.received` into `domain_events`
- updates delivery status rows for status callbacks

If `META_APP_SECRET` is configured, `x-hub-signature-256` is required and verified before persistence.

## Retry Policy

Outbound WhatsApp sends are handled by the outbox worker.
5xx responses retry once inside the Meta call; worker-level retry and dead-letter behavior remains controlled by `outbox_events`.
