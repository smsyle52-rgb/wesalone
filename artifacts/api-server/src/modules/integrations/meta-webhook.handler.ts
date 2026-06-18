import { and, desc, eq, sql } from "drizzle-orm";
import {
  channelAccountsTable,
  contactChannelsTable,
  contactsTable,
  conversationsTable,
  db,
  domainEventsTable,
  messagesTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { emitWorkspaceEvent } from "../../lib/events";
import { handleInstagramWebhook } from "./instagram.handler";
import { handleMessengerWebhook } from "./messenger.handler";
import { notifyWorkspace } from "../../services/notifications";

export type MetaWebhookResult = {
  handled: boolean;
  messagesCreated: number;
  statusesUpdated: number;
};

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  return `+${cleaned}`;
}

function findMessages(payload: any): any[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any) =>
    (entry.changes ?? []).flatMap((change: any) => change.value?.messages ?? []),
  );
}

function findStatuses(payload: any): any[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any) =>
    (entry.changes ?? []).flatMap((change: any) => change.value?.statuses ?? []),
  );
}

function findPhoneNumberId(payload: any): string | null {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (typeof id === "string" && id) return id;
    }
  }
  return null;
}

function mediaAttachment(message: any): Record<string, unknown> | null {
  const type = typeof message?.type === "string" ? message.type : "unknown";
  const media = message?.[type] ?? {};
  const mediaId = typeof media.id === "string" ? media.id : null;
  if (!["image", "audio", "voice", "document", "video", "sticker"].includes(type) || !mediaId) return null;
  return {
    type,
    provider: "meta",
    media_id: mediaId,
    mime_type: media.mime_type ?? null,
    sha256: media.sha256 ?? null,
    caption: media.caption ?? null,
  };
}

function messageContent(message: any): { contentType: string; content: string; providerPayload: Record<string, unknown>; attachments: Record<string, unknown>[] } {
  if (message.type === "text") {
    return { contentType: "text", content: message.text?.body ?? "", providerPayload: message, attachments: [] };
  }
  if (message.type === "location") {
    const location = message.location ?? {};
    const label = [location.name, location.address].filter(Boolean).join(" - ");
    return {
      contentType: "location",
      content: label || "موقع مرسل من العميل",
      providerPayload: message,
      attachments: [{
        type: "location",
        provider: "meta",
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        address: location.address ?? null,
        name: location.name ?? null,
      }],
    };
  }
  const mediaId = message[message.type]?.id;
  const attachment = mediaAttachment(message);
  return {
    contentType: message.type ?? "unknown",
    content: mediaId ? `[${message.type}:${mediaId}]` : `[${message.type ?? "message"}]`,
    providerPayload: message,
    attachments: attachment ? [attachment] : [],
  };
}

async function findChannelAccount(phoneNumberId: string) {
  const [account] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.channelType, "whatsapp"),
      eq(channelAccountsTable.status, "active"),
      sql`(${channelAccountsTable.providerConfig}->>'phone_number_id' = ${phoneNumberId} OR ${channelAccountsTable.providerConfig}->>'phoneNumberId' = ${phoneNumberId})`,
    ))
    .limit(1);
  return account ?? null;
}

export async function handleMetaWhatsAppWebhook(payload: unknown): Promise<MetaWebhookResult> {
  const body = payload as any;
  const phoneNumberId = findPhoneNumberId(body);
  if (!phoneNumberId) return { handled: false, messagesCreated: 0, statusesUpdated: 0 };

  const channelAccount = await findChannelAccount(phoneNumberId);
  if (!channelAccount) {
    logger.warn({ phoneNumberId }, "Meta webhook phone number is not linked to a channel account");
    return { handled: false, messagesCreated: 0, statusesUpdated: 0 };
  }

  let messagesCreated = 0;
  let statusesUpdated = 0;
  const workspaceId = channelAccount.workspaceId;

  for (const inbound of findMessages(body)) {
    const providerMessageId = inbound.id;
    if (!providerMessageId) continue;

    const [existing] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(eq(messagesTable.workspaceId, workspaceId), eq(messagesTable.providerMessageId, providerMessageId)))
      .limit(1);
    if (existing) continue;

    const normalized = normalizePhone(String(inbound.from ?? ""));
    if (!normalized || normalized === "+") continue;

    const [existingChannel] = await db
      .select()
      .from(contactChannelsTable)
      .where(and(
        eq(contactChannelsTable.workspaceId, workspaceId),
        sql`${contactChannelsTable.channelType} in ('phone', 'whatsapp', 'whatsapp_api')`,
        eq(contactChannelsTable.normalizedIdentifier, normalized),
      ))
      .limit(1);

    let contactId = existingChannel?.contactId;
    let contactChannelId = existingChannel?.id;

    if (contactId) {
      const [whatsappChannel] = await db
        .insert(contactChannelsTable)
        .values({
          workspaceId,
          contactId,
          channelType: "whatsapp",
          identifier: normalized,
          normalizedIdentifier: normalized,
          isPrimary: true,
          isVerified: true,
          optedIn: true,
          providerData: { phoneNumberId },
        })
        .onConflictDoNothing()
        .returning();
      contactChannelId = whatsappChannel?.id ?? contactChannelId;
    } else {
      const [contact] = await db
        .insert(contactsTable)
        .values({ workspaceId, name: normalized, phone: normalized, createdAt: new Date(), updatedAt: new Date() })
        .returning();
      contactId = contact.id;
      const [channel] = await db
        .insert(contactChannelsTable)
        .values({
          workspaceId,
          contactId,
          channelType: "whatsapp",
          identifier: normalized,
          normalizedIdentifier: normalized,
          isPrimary: true,
          isVerified: true,
          optedIn: true,
          providerData: { phoneNumberId },
        })
        .returning();
      contactChannelId = channel.id;
    }

    if (inbound.type === "location" && contactId) {
      const location = inbound.location ?? {};
      const address = [location.name, location.address].filter(Boolean).join(" - ");
      await db.update(contactsTable)
        .set({
          city: typeof location.name === "string" ? location.name : undefined,
          locationNote: address || JSON.stringify({ latitude: location.latitude, longitude: location.longitude }),
          updatedAt: new Date(),
        })
        .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, workspaceId)));
    }

    const [existingConversation] = await db
      .select()
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.workspaceId, workspaceId),
        eq(conversationsTable.contactId, contactId),
        eq(conversationsTable.channelAccountId, channelAccount.id),
        sql`${conversationsTable.status} <> 'closed'`,
        sql`${conversationsTable.createdAt} > now() - interval '24 hours'`,
      ))
      .orderBy(desc(conversationsTable.lastMessageAt), desc(conversationsTable.createdAt))
      .limit(1);

    const conversation = existingConversation ?? (await db
      .insert(conversationsTable)
      .values({
        workspaceId,
        contactId,
        contactChannelId,
        channelAccountId: channelAccount.id,
        channel: "whatsapp",
        status: "open",
        priority: "normal",
        externalThreadId: normalized,
      })
      .returning())[0];

    const content = messageContent(inbound);
    const sentAt = inbound.timestamp ? new Date(Number(inbound.timestamp) * 1000) : new Date();
    const [message] = await db
      .insert(messagesTable)
      .values({
        workspaceId,
        conversationId: conversation.id,
        providerMessageId,
        direction: "inbound",
        senderType: "contact",
        source: "whatsapp_cloud",
        contentType: content.contentType,
        content: content.content,
        attachments: content.attachments,
        providerPayload: content.providerPayload,
        deliveryStatus: "received",
        sentAt,
      })
      .returning();

    await db.update(conversationsTable)
      .set({
        lastMessage: content.content.slice(0, 120),
        lastMessageAt: sentAt,
        unreadCount: sql`${conversationsTable.unreadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(conversationsTable.id, conversation.id), eq(conversationsTable.workspaceId, workspaceId)));

    await db.insert(domainEventsTable).values({
      workspaceId,
      eventType: "message.received",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { conversationId: conversation.id, contactId, channelAccountId: channelAccount.id, providerMessageId, messageId: message.id },
    });
    emitWorkspaceEvent({
      workspaceId,
      type: "message.received",
      entityType: "message",
      entityId: message.id,
      payload: { conversationId: conversation.id, contactId, channelAccountId: channelAccount.id, providerMessageId },
    });

    await notifyWorkspace({
      workspaceId,
      type: "message.received",
      titleAr: "رسالة واتساب جديدة",
      bodyAr: "وصلت رسالة جديدة من عميل عبر واتساب.",
      link: `/inbox?conversation=${conversation.id}`,
    });

    messagesCreated += 1;
  }

  for (const status of findStatuses(body)) {
    const providerMessageId = status.id;
    if (!providerMessageId) continue;
    const deliveryStatus = status.status ?? "unknown";
    const update: Record<string, unknown> = { deliveryStatus, providerPayload: status };
    const updated = await db.update(messagesTable)
      .set(update)
      .where(and(eq(messagesTable.workspaceId, workspaceId), eq(messagesTable.providerMessageId, providerMessageId)))
      .returning({ id: messagesTable.id });
    statusesUpdated += updated.length;
  }

  return { handled: true, messagesCreated, statusesUpdated };
}

export async function handleMetaWebhook(payload: unknown): Promise<MetaWebhookResult> {
  const objectType = (payload as any)?.object;

  if (objectType === "whatsapp_business_account") {
    return handleMetaWhatsAppWebhook(payload);
  }

  if (objectType === "instagram") {
    const messagesCreated = await handleInstagramWebhook(payload);
    return { handled: messagesCreated > 0, messagesCreated, statusesUpdated: 0 };
  }

  if (objectType === "page") {
    const messagesCreated = await handleMessengerWebhook(payload);
    return { handled: messagesCreated > 0, messagesCreated, statusesUpdated: 0 };
  }

  logger.warn({ objectType }, "Unsupported Meta webhook object type");
  return { handled: false, messagesCreated: 0, statusesUpdated: 0 };
}
