# Meta Channels Integration

Phase 5-Prep keeps one Meta App and one OAuth flow for three channels: WhatsApp, Instagram, and Messenger. Development remains safe by default through `META_DRY_RUN` and by requiring operator-managed secrets before any live provider behavior.

## Environment

Required for live mode:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `META_GRAPH_VERSION`
- `META_OAUTH_STATE_SECRET`

Optional channel hints and token references:

- `META_WABA_ID`
- `META_PHONE_NUMBER_ID`
- `META_FACEBOOK_PAGE_ID`
- `META_INSTAGRAM_BUSINESS_ID`
- `META_ACCESS_TOKEN_SECRET_REF`
- `META_PAGE_ACCESS_TOKEN_SECRET_REF`
- `META_SYSTEM_USER_TOKEN`
- `META_ACCESS_TOKEN`
- `META_DRY_RUN=true`

No access token, app secret, or verify token is committed, logged, returned to the UI, or stored as a plain database value.

## Unified OAuth Flow

`GET /api/integrations/meta/embedded-signup/start` creates a CSRF state in the session and returns a Meta OAuth URL with scopes for all three channels:

- `whatsapp_business_messaging`
- `whatsapp_business_management`
- `business_management`
- `instagram_basic`
- `instagram_manage_messages`
- `pages_messaging`
- `pages_manage_metadata`
- `pages_show_list`

`GET /api/integrations/meta/embedded-signup/callback` validates state, exchanges the code when live credentials are present, discovers connected WABAs, Facebook Pages, and Instagram Business accounts, then redirects the user to `/integrations/meta/select-channels`.

The selection page posts to `POST /api/integrations/meta/channels` with selected phone numbers, Instagram accounts, and Facebook pages. The server creates one `channel_accounts` row per selected entity:

- `channel_type='whatsapp'` with `{ wabaId, phoneNumberId }`
- `channel_type='instagram'` with `{ igAccountId, pageId }`
- `channel_type='messenger'` with `{ pageId }`

Tokens are stored as encrypted references in `channel_accounts.credentials_secret_ref`. Production should replace these with Google Secret Manager references.

## Discovery Shape

The callback aggregates Meta entities into this internal shape. UI responses omit token values.

```json
{
  "whatsapp_accounts": [
    {
      "waba_id": "123",
      "name": "Business",
      "phone_numbers": [
        {
          "phone_number_id": "456",
          "display_number": "+967...",
          "verified_name": "Store"
        }
      ]
    }
  ],
  "facebook_pages": [
    {
      "page_id": "789",
      "name": "Store Page"
    }
  ],
  "instagram_accounts": [
    {
      "ig_account_id": "999",
      "username": "store",
      "linked_page_id": "789"
    }
  ]
}
```

## Webhook Dispatch

Generic webhook ingestion records raw events first. Meta HMAC verification is shared for WhatsApp, Instagram, and Messenger when `META_APP_SECRET` is configured.

The handler switches on the top-level `object` field:

- `whatsapp_business_account` -> WhatsApp handler
- `instagram` -> Instagram handler
- `page` -> Messenger handler

### WhatsApp Payload

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "changes": [
        {
          "value": {
            "metadata": { "phone_number_id": "456" },
            "messages": [
              { "id": "wamid...", "from": "9677...", "type": "text", "text": { "body": "مرحبا" } }
            ]
          }
        }
      ]
    }
  ]
}
```

### Instagram Messaging Payload

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "ig_account_id",
      "changes": [
        {
          "field": "messages",
          "value": {
            "sender": { "id": "ig_scoped_user_id" },
            "message": { "mid": "mid...", "text": "مرحبا" }
          }
        }
      ]
    }
  ]
}
```

Comments are intentionally ignored in this phase.

### Messenger Payload

```json
{
  "object": "page",
  "entry": [
    {
      "id": "page_id",
      "messaging": [
        {
          "sender": { "id": "psid" },
          "recipient": { "id": "page_id" },
          "message": { "mid": "mid...", "text": "مرحبا" }
        }
      ]
    }
  ]
}
```

## Outbound Dispatch

The outbox worker supports these event types:

- `message.send.whatsapp.template`
- `message.send.whatsapp.text`
- `message.send.instagram.text`
- `message.send.messenger.text`

When `META_APP_SECRET` or a runtime token is absent, the worker logs `DRY_RUN`, creates synthetic provider IDs, and does not call Meta.

## Known Limitations

- Instagram messaging requires the user to message first and is constrained by Meta's messaging window policies.
- Messenger also follows Meta page messaging policies.
- Page and system tokens should be stored in Google Secret Manager before production live sending.
- Comments, media download, and rich attachments are deferred.
