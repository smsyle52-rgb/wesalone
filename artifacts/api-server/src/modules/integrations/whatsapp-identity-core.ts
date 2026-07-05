export const WHATSAPP_BSUID_FLAG = "WHATSAPP_BSUID_ENABLED";

export type WhatsAppIdentityType = "whatsapp_phone" | "whatsapp_bsuid";

export type WhatsAppInboundIdentity = {
  phone: string | null;
  bsuid: string | null;
  username: string | null;
  profileName: string | null;
  rawFrom: string | null;
};

export type WhatsAppRecipientResolution =
  | { ok: true; to: string; identityType: WhatsAppIdentityType }
  | { ok: false; code: "WHATSAPP_RECIPIENT_MISSING" | "WHATSAPP_BSUID_DISABLED"; message: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = nonEmptyString(value);
    if (str) return str;
  }
  return null;
}

export function isWhatsAppBsuidEnabled(env: Pick<NodeJS.ProcessEnv, string> = process.env): boolean {
  return String(env[WHATSAPP_BSUID_FLAG] ?? "").trim().toLowerCase() === "true";
}

export function normalizeWhatsAppPhone(raw: unknown): string | null {
  const value = nonEmptyString(raw);
  if (!value) return null;
  if (!/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 20) return null;
  return `+${digits}`;
}

export function normalizeWhatsAppBsuid(raw: unknown): string | null {
  const value = nonEmptyString(raw);
  if (!value) return null;
  return value;
}

function contactsFromValue(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const contacts = value.contacts;
  return Array.isArray(contacts)
    ? contacts.filter((contact): contact is Record<string, unknown> => !!contact && typeof contact === "object" && !Array.isArray(contact))
    : [];
}

function chooseContact(value: Record<string, unknown>, rawFrom: string | null): Record<string, unknown> {
  const contacts = contactsFromValue(value);
  if (contacts.length === 0) return {};
  if (!rawFrom) return contacts[0] ?? {};
  return contacts.find((contact) => (
    firstString(contact.wa_id, contact.waId, contact.user_id, contact.userId) === rawFrom
  )) ?? contacts[0] ?? {};
}

export function extractWhatsAppInboundIdentity(valueInput: unknown, messageInput: unknown): WhatsAppInboundIdentity {
  const value = asRecord(valueInput);
  const message = asRecord(messageInput);
  const rawFrom = firstString(message.from, message.sender, message.customer_id);
  const contact = chooseContact(value, rawFrom);
  const profile = asRecord(contact.profile ?? message.profile);

  const explicitBsuid = firstString(
    message.user_id,
    message.userId,
    message.bsuid,
    contact.user_id,
    contact.userId,
    contact.bsuid,
  );
  const waId = firstString(contact.wa_id, contact.waId);

  const phoneCandidate = waId ?? (explicitBsuid ? null : rawFrom);
  const bsuidCandidate = explicitBsuid ?? (waId && rawFrom && rawFrom !== waId ? rawFrom : null);

  return {
    phone: normalizeWhatsAppPhone(phoneCandidate),
    bsuid: normalizeWhatsAppBsuid(bsuidCandidate),
    username: firstString(message.username, contact.username, profile.username),
    profileName: firstString(profile.name, contact.name, message.name),
    rawFrom,
  };
}

export function preferredWhatsAppThreadId(identity: WhatsAppInboundIdentity): string | null {
  return identity.bsuid ?? identity.phone ?? identity.rawFrom;
}

export function maskWhatsAppIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

export function resolveWhatsAppRecipientAddress(params: {
  phone?: string | null;
  bsuid?: string | null;
  conversationThreadId?: string | null;
  bsuidEnabled?: boolean;
}): WhatsAppRecipientResolution {
  const phone = normalizeWhatsAppPhone(params.phone);
  const bsuid = normalizeWhatsAppBsuid(params.bsuid);
  const threadId = nonEmptyString(params.conversationThreadId);
  const bsuidEnabled = params.bsuidEnabled ?? isWhatsAppBsuidEnabled();

  if (bsuid && threadId === bsuid) {
    if (!bsuidEnabled) {
      return {
        ok: false,
        code: "WHATSAPP_BSUID_DISABLED",
        message: `${WHATSAPP_BSUID_FLAG} is disabled for WhatsApp BSUID recipients`,
      };
    }
    return { ok: true, to: bsuid, identityType: "whatsapp_bsuid" };
  }

  if (phone) return { ok: true, to: phone, identityType: "whatsapp_phone" };

  if (bsuid) {
    if (!bsuidEnabled) {
      return {
        ok: false,
        code: "WHATSAPP_BSUID_DISABLED",
        message: `${WHATSAPP_BSUID_FLAG} is disabled for WhatsApp BSUID recipients`,
      };
    }
    return { ok: true, to: bsuid, identityType: "whatsapp_bsuid" };
  }

  if (threadId) {
    const threadPhone = normalizeWhatsAppPhone(threadId);
    if (threadPhone) return { ok: true, to: threadPhone, identityType: "whatsapp_phone" };
  }

  return {
    ok: false,
    code: "WHATSAPP_RECIPIENT_MISSING",
    message: "No WhatsApp phone or BSUID recipient is available",
  };
}
