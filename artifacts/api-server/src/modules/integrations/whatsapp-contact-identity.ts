import { and, eq, inArray, sql } from "drizzle-orm";
import {
  contactChannelIdentitiesTable,
  contactChannelsTable,
  contactsTable,
  db,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  extractWhatsAppInboundIdentity,
  maskWhatsAppIdentifier,
  normalizeWhatsAppPhone,
  preferredWhatsAppThreadId,
  resolveWhatsAppRecipientAddress,
  type WhatsAppIdentityType,
  type WhatsAppInboundIdentity,
  type WhatsAppRecipientResolution,
} from "./whatsapp-identity-core";

type ProviderConfigLike = Record<string, unknown> | null | undefined;

export type WhatsAppContactResolution = {
  contactId: string;
  contactChannelId: string | null;
  externalThreadId: string;
  recipientIdentityType: WhatsAppIdentityType;
  identity: WhatsAppInboundIdentity;
};

function stringConfig(config: ProviderConfigLike, ...keys: string[]): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function businessScopeFromProviderConfig(config: ProviderConfigLike): string | null {
  return stringConfig(config, "waba_id", "wabaId", "business_id", "businessId", "portfolio_id", "portfolioId");
}

async function findIdentity(params: {
  workspaceId: string;
  channelAccountId: string;
  identityType: WhatsAppIdentityType;
  normalizedIdentity: string;
}) {
  const [row] = await db
    .select()
    .from(contactChannelIdentitiesTable)
    .where(and(
      eq(contactChannelIdentitiesTable.workspaceId, params.workspaceId),
      eq(contactChannelIdentitiesTable.channelAccountId, params.channelAccountId),
      eq(contactChannelIdentitiesTable.identityType, params.identityType),
      eq(contactChannelIdentitiesTable.normalizedIdentity, params.normalizedIdentity),
    ))
    .limit(1);
  return row ?? null;
}

async function phoneLinkedToDifferentChannel(params: {
  workspaceId: string;
  channelAccountId: string;
  phone: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ id: contactChannelIdentitiesTable.id })
    .from(contactChannelIdentitiesTable)
    .where(and(
      eq(contactChannelIdentitiesTable.workspaceId, params.workspaceId),
      eq(contactChannelIdentitiesTable.identityType, "whatsapp_phone"),
      eq(contactChannelIdentitiesTable.normalizedIdentity, params.phone),
      sql`${contactChannelIdentitiesTable.channelAccountId} <> ${params.channelAccountId}`,
    ))
    .limit(1);
  return Boolean(row);
}

async function findLegacyContactByPhone(workspaceId: string, phone: string): Promise<{ contactId: string; contactChannelId: string | null } | null> {
  const [existingChannel] = await db
    .select({ contactId: contactChannelsTable.contactId, contactChannelId: contactChannelsTable.id })
    .from(contactChannelsTable)
    .where(and(
      eq(contactChannelsTable.workspaceId, workspaceId),
      inArray(contactChannelsTable.channelType, ["phone", "whatsapp", "whatsapp_api"]),
      eq(contactChannelsTable.normalizedIdentifier, phone),
    ))
    .limit(1);

  if (existingChannel) {
    return {
      contactId: existingChannel.contactId,
      contactChannelId: existingChannel.contactChannelId,
    };
  }

  const [contact] = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(and(eq(contactsTable.workspaceId, workspaceId), eq(contactsTable.phone, phone)))
    .limit(1);

  return contact ? { contactId: contact.id, contactChannelId: null } : null;
}

async function ensurePhoneContactChannel(params: {
  workspaceId: string;
  contactId: string;
  phone: string;
  phoneNumberId: string | null;
  rawPhone: string | null;
}): Promise<string | null> {
  const [existing] = await db
    .select({ id: contactChannelsTable.id, contactId: contactChannelsTable.contactId })
    .from(contactChannelsTable)
    .where(and(
      eq(contactChannelsTable.workspaceId, params.workspaceId),
      inArray(contactChannelsTable.channelType, ["phone", "whatsapp", "whatsapp_api"]),
      eq(contactChannelsTable.normalizedIdentifier, params.phone),
    ))
    .limit(1);

  if (existing) return existing.contactId === params.contactId ? existing.id : null;

  const [created] = await db
    .insert(contactChannelsTable)
    .values({
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      channelType: "whatsapp",
      identifier: params.phone,
      normalizedIdentifier: params.phone,
      isPrimary: true,
      isVerified: true,
      optedIn: true,
      providerData: {
        externalId: params.rawPhone ?? params.phone,
        phoneNumberId: params.phoneNumberId,
        source: "whatsapp_identity_resolver",
      },
    })
    .onConflictDoNothing()
    .returning({ id: contactChannelsTable.id });

  return created?.id ?? null;
}

async function ensureScopedIdentity(params: {
  workspaceId: string;
  contactId: string;
  channelAccountId: string;
  identityType: WhatsAppIdentityType;
  identityValue: string;
  normalizedIdentity: string;
  businessScopeId: string | null;
  isPrimary: boolean;
  isVerified: boolean;
  providerData: Record<string, unknown>;
}): Promise<void> {
  await db
    .insert(contactChannelIdentitiesTable)
    .values({
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      channelAccountId: params.channelAccountId,
      channelType: "whatsapp",
      identityType: params.identityType,
      identityValue: params.identityValue,
      normalizedIdentity: params.normalizedIdentity,
      businessScopeId: params.businessScopeId,
      isPrimary: params.isPrimary,
      isVerified: params.isVerified,
      providerData: params.providerData,
    })
    .onConflictDoNothing();

  const existing = await findIdentity(params);
  if (!existing) return;
  if (existing.contactId !== params.contactId) {
    logger.warn({
      workspaceId: params.workspaceId,
      channelAccountId: params.channelAccountId,
      identityType: params.identityType,
      identity: maskWhatsAppIdentifier(params.normalizedIdentity),
      existingContactId: existing.contactId,
      attemptedContactId: params.contactId,
    }, "WhatsApp identity already belongs to another contact; refusing automatic merge");
    return;
  }

  await db
    .update(contactChannelIdentitiesTable)
    .set({
      identityValue: params.identityValue,
      businessScopeId: params.businessScopeId,
      isPrimary: params.isPrimary,
      isVerified: params.isVerified,
      providerData: params.providerData,
      updatedAt: new Date(),
    })
    .where(and(
      eq(contactChannelIdentitiesTable.id, existing.id),
      eq(contactChannelIdentitiesTable.workspaceId, params.workspaceId),
    ));
}

async function createContact(params: {
  workspaceId: string;
  identity: WhatsAppInboundIdentity;
}): Promise<string> {
  const name = params.identity.profileName
    ?? params.identity.username
    ?? params.identity.phone
    ?? (params.identity.bsuid ? `WhatsApp ${maskWhatsAppIdentifier(params.identity.bsuid)}` : "WhatsApp customer");

  const [contact] = await db
    .insert(contactsTable)
    .values({
      workspaceId: params.workspaceId,
      name,
      phone: params.identity.phone,
      lastContactedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: contactsTable.id });

  if (!contact) throw new Error("Failed to create WhatsApp contact identity");
  return contact.id;
}

export async function resolveWhatsAppInboundContact(params: {
  workspaceId: string;
  channelAccountId: string;
  phoneNumberId: string | null;
  businessScopeId: string | null;
  value: unknown;
  message: unknown;
}): Promise<WhatsAppContactResolution | null> {
  const identity = extractWhatsAppInboundIdentity(params.value, params.message);
  const externalThreadId = preferredWhatsAppThreadId(identity);
  if (!externalThreadId || (!identity.phone && !identity.bsuid)) return null;

  let contactId: string | null = null;
  let contactChannelId: string | null = null;
  let recipientIdentityType: WhatsAppIdentityType = identity.bsuid ? "whatsapp_bsuid" : "whatsapp_phone";

  if (identity.bsuid) {
    const existingBsuid = await findIdentity({
      workspaceId: params.workspaceId,
      channelAccountId: params.channelAccountId,
      identityType: "whatsapp_bsuid",
      normalizedIdentity: identity.bsuid,
    });
    if (existingBsuid) contactId = existingBsuid.contactId;
  }

  if (!contactId && identity.phone) {
    const existingPhone = await findIdentity({
      workspaceId: params.workspaceId,
      channelAccountId: params.channelAccountId,
      identityType: "whatsapp_phone",
      normalizedIdentity: identity.phone,
    });
    if (existingPhone) {
      contactId = existingPhone.contactId;
      recipientIdentityType = "whatsapp_phone";
    }
  }

  if (!contactId && identity.phone) {
    const linkedElsewhere = await phoneLinkedToDifferentChannel({
      workspaceId: params.workspaceId,
      channelAccountId: params.channelAccountId,
      phone: identity.phone,
    });
    if (!linkedElsewhere) {
      const legacy = await findLegacyContactByPhone(params.workspaceId, identity.phone);
      if (legacy) {
        contactId = legacy.contactId;
        contactChannelId = legacy.contactChannelId;
        recipientIdentityType = "whatsapp_phone";
      }
    }
  }

  if (!contactId) {
    contactId = await createContact({ workspaceId: params.workspaceId, identity });
  } else {
    await db
      .update(contactsTable)
      .set({
        lastContactedAt: new Date(),
        updatedAt: new Date(),
        ...(identity.phone ? { phone: sql`COALESCE(${contactsTable.phone}, ${identity.phone})` } : {}),
        ...(identity.profileName ? { name: sql`CASE WHEN ${contactsTable.name} LIKE 'WhatsApp %' OR ${contactsTable.name} = ${identity.phone ?? ""} THEN ${identity.profileName} ELSE ${contactsTable.name} END` } : {}),
      })
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, params.workspaceId)));
  }

  if (identity.phone) {
    contactChannelId = await ensurePhoneContactChannel({
      workspaceId: params.workspaceId,
      contactId,
      phone: identity.phone,
      phoneNumberId: params.phoneNumberId,
      rawPhone: identity.rawFrom,
    }) ?? contactChannelId;

    await ensureScopedIdentity({
      workspaceId: params.workspaceId,
      contactId,
      channelAccountId: params.channelAccountId,
      identityType: "whatsapp_phone",
      identityValue: identity.phone,
      normalizedIdentity: identity.phone,
      businessScopeId: params.businessScopeId,
      isPrimary: !identity.bsuid,
      isVerified: true,
      providerData: { phoneNumberId: params.phoneNumberId, source: "webhook" },
    });
  }

  if (identity.bsuid) {
    await ensureScopedIdentity({
      workspaceId: params.workspaceId,
      contactId,
      channelAccountId: params.channelAccountId,
      identityType: "whatsapp_bsuid",
      identityValue: identity.bsuid,
      normalizedIdentity: identity.bsuid,
      businessScopeId: params.businessScopeId,
      isPrimary: true,
      isVerified: true,
      providerData: {
        phoneNumberId: params.phoneNumberId,
        username: identity.username,
        profileName: identity.profileName,
        source: "webhook",
      },
    });
  }

  return {
    contactId,
    contactChannelId,
    externalThreadId,
    recipientIdentityType,
    identity,
  };
}

export async function resolveWhatsAppConversationRecipient(params: {
  workspaceId: string;
  channelAccountId: string;
  contactId: string | null;
  contactChannelId?: string | null;
  externalThreadId?: string | null;
}): Promise<WhatsAppRecipientResolution> {
  let phone: string | null = null;
  let bsuid: string | null = null;

  if (params.contactId) {
    const identities = await db
      .select({
        identityType: contactChannelIdentitiesTable.identityType,
        normalizedIdentity: contactChannelIdentitiesTable.normalizedIdentity,
      })
      .from(contactChannelIdentitiesTable)
      .where(and(
        eq(contactChannelIdentitiesTable.workspaceId, params.workspaceId),
        eq(contactChannelIdentitiesTable.channelAccountId, params.channelAccountId),
        eq(contactChannelIdentitiesTable.contactId, params.contactId),
        inArray(contactChannelIdentitiesTable.identityType, ["whatsapp_phone", "whatsapp_bsuid"]),
      ));

    for (const identity of identities) {
      if (identity.identityType === "whatsapp_bsuid") bsuid ??= identity.normalizedIdentity;
      if (identity.identityType === "whatsapp_phone") phone ??= identity.normalizedIdentity;
    }
  }

  if (!phone && params.contactChannelId) {
    const [channel] = await db
      .select({ normalizedIdentifier: contactChannelsTable.normalizedIdentifier })
      .from(contactChannelsTable)
      .where(and(
        eq(contactChannelsTable.workspaceId, params.workspaceId),
        eq(contactChannelsTable.id, params.contactChannelId),
      ))
      .limit(1);
    phone = normalizeWhatsAppPhone(channel?.normalizedIdentifier);
  }

  if (!phone && params.contactId) {
    const [contact] = await db
      .select({ phone: contactsTable.phone })
      .from(contactsTable)
      .where(and(eq(contactsTable.workspaceId, params.workspaceId), eq(contactsTable.id, params.contactId)))
      .limit(1);
    phone = normalizeWhatsAppPhone(contact?.phone);
  }

  return resolveWhatsAppRecipientAddress({
    phone,
    bsuid,
    conversationThreadId: params.externalThreadId,
  });
}
