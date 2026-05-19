# Meta Test App Setup Guide

## Step 1: Configure Test App (956632443920182)
- Go to developers.facebook.com -> App 956632443920182.
- Add Products: WhatsApp, Messenger, Instagram Graph API.

## Step 2: WhatsApp Setup
- WhatsApp -> Getting Started.
- Note the Test Phone Number ID.
- Note the WhatsApp Business Account ID (WABA ID).
- Add your personal WhatsApp number as a test recipient.

## Step 3: Configure OAuth
- App Settings -> Basic -> Note the App Secret. Keep it private.
- Facebook Login -> Settings -> Valid OAuth Redirect URIs.
- Add:

```text
https://khadamatak-staging-1067617934225.us-central1.run.app/api/integrations/meta/embedded-signup/callback
```

## Step 4: Configure Webhook
- WhatsApp -> Configuration -> Webhook.
- Callback URL:

```text
https://khadamatak-staging-1067617934225.us-central1.run.app/api/webhooks/meta
```

- Verify Token: use the exact value set as `META_VERIFY_TOKEN` in Cloud Run.
- Subscribe to: messages, message_deliveries, message_reads.

## Step 5: Set Cloud Run Environment Variables
The operator sets these values. Never commit secret values.

```text
META_APP_ID=956632443920182
META_APP_SECRET=<from App Settings -> Basic>
META_VERIFY_TOKEN=<choose a random string, save it>
META_REDIRECT_URI=https://khadamatak-staging-1067617934225.us-central1.run.app/api/integrations/meta/embedded-signup/callback
META_DRY_RUN=false
```

## Step 6: Test The Flow
- Login to khadamatak-staging.
- Go to `/integrations`.
- Click "ربط قنوات ميتا".
- Complete OAuth.
- Select the WhatsApp test number.
- Send a test message from your personal WhatsApp to the test number.
- Verify the message appears in `/inbox`.
