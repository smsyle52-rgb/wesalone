# WhatsApp BSUID Safe Support

This change adds backward-compatible support for WhatsApp Business-Scoped User IDs (`user_id` / BSUID) without replacing the existing phone-based flow.

## What changes

- Inbound WhatsApp webhooks can now resolve a contact from:
  - phone only
  - BSUID only
  - phone and BSUID together
- Internal ownership stays on `contact_id`.
- Scoped WhatsApp identities are stored in `contact_channel_identities`.
- Existing phone-based contacts, conversations, orders, and memory keep working as-is.

## Safety model

- Storage is additive and always safe:
  - phone identities can still be stored
  - BSUID identities can be stored without turning on BSUID sending
- Sending to BSUID is gated by `WHATSAPP_BSUID_ENABLED=true`.
- If the flag is absent or set to any value other than `true`, outbound WhatsApp stays phone-first.
- Embedded Signup, verification, and channel connection state are unchanged by this flag.

## Rollout

1. Deploy code and migration first.
2. Let production keep running with `WHATSAPP_BSUID_ENABLED` unset.
3. Observe logs for:
   - inbound phone-only traffic
   - inbound BSUID-only traffic
   - linked phone plus BSUID identities
   - recipient resolution failures
4. Enable `WHATSAPP_BSUID_ENABLED=true` only after validating a WhatsApp account that actually produces BSUID traffic.

## Rollback

- Set `WHATSAPP_BSUID_ENABLED=false` or remove the variable.
- Outbound sending will immediately return to phone-based recipient resolution.
- Stored BSUID identity rows remain in the database for later reuse.
- No data backfill or schema rollback is required for an operational rollback.

## Migration

- Drizzle migration: `lib/db/drizzle/0032_whatsapp_bsuid_identities.sql`
- Production bundle migration: `scripts/migrate-phase345.sql`

## Notes

- Template or OTP-like WhatsApp sends should not silently target BSUID when a phone recipient is required.
- The feature is scoped by workspace and channel account to avoid cross-tenant or cross-connection contact merges.
