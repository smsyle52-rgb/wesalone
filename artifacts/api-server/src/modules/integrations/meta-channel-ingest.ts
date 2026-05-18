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
import { emitWorkspaceEvent } from "../../lib/events";
import { logger } from "../../lib/logger";

type MetaChannelType = "instagram" | "messenger";

type IngestMetaChannelMessageParams = {
  channelType: MetaChannelType;
  source: string;
  accountConfigKey: "igAccountId" | "pageId";
  accountConfigValue: string;
  senderId: string;
  providerMessageId: string;
  text: string;
  timestamp?: number | null;
  providerPayload: Record<string, unknown>;
};

async function findChannelAccount(
  channelType: MetaChannelType,
  configKey: "igAccountId" | "pageId",
  configValue: string,
) {
  const [account] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.channelType, channelType),
      sql`${channelAccountsTable.providerConfig}->>${configKey} = ${configValue}`,
    ))
    .limit(1);
  return account ?? null;
}

export async function ingestMetaChannelMessage(params: IngestMetaChannelMessageParams): Promise<boolean> {
  if (!params.providerMessageId || !params.senderId || !params.text.trim()) return false;

  const channelAccount = await findChannelAccount(
    params.channelType,
    params.accountConfigKey,
    params.accountConfigValue,
  );

  if (!channelAccount) {
    logger.warn({
      channelType: params.channelType,
      accountConfigKey: params.accountConfigKey,
      accountConfigValue: params.accountConfigValue,
    }, "Meta webhook account is not linked to a channel account");
    return false;
  }

  const workspaceId = channelAccount.workspaceId;
  const [existingMessage] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.workspaceId, workspaceId),
      eq(messagesTable.providerMessageId, params.providerMessageId),
    ))
    .limit(1);

  if (existingMessage) return false;

  const normalizedIdentifier = params.senderId.trim();
  const [existingChannel] = await db
    .select()
    .from(contactChannelsTable)
    .where(and(
      eq(contactChannelsTable.workspaceId, workspaceId),
      eq(contactChannelsTable.channelType, params.channelType),
      eq(contactChannelsTable.normalizedIdentifier, normalizedIdentifier),
    ))
    .limit(1);

  let contactId = existingChannel?.contactId;
  let contactChannelId = existingChannel?.id;

  if (!contactId) {
    const [contact] = await db
      .insert(contactsTable)
      .values({
        workspaceId,
        name: `${params.channelType}:${normalizedIdentifier}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    contactId = contact.id;

    const [channel] = await db
      .insert(contactChannelsTable)
      .values({
        workspaceId,
        contactId,
        channelType: params.channelType,
        identifier: normalizedIdentifier,
        normalizedIdentifier,
        isPrimary: true,
        isVerified: false,
        optedIn: true,
        providerData: {
          metaAccount: params.accountConfigValue,
          source: params.source,
        },
      })
      .returning();
    contactChannelId = channel.id;
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
      channel: params.channelType,
      status: "open",
      priority: "normal",
      externalThreadId: normalizedIdentifier,
    })
    .returning())[0];

  const sentAt = params.timestamp ? new Date(params.timestamp * 1000) : new Date();
  const [message] = await db
    .insert(messagesTable)
    .values({
      workspaceId,
      conversationId: conversation.id,
      providerMessageId: params.providerMessageId,
      direction: "inbound",
      senderType: "contact",
      source: params.source,
      contentType: "text",
      content: params.text,
      providerPayload: params.providerPayload,
      deliveryStatus: "received",
      sentAt,
    })
    .returning();

  await db.update(conversationsTable)
    .set({
      lastMessage: params.text.slice(0, 120),
      lastMessageAt: sentAt,
      unreadCount: sql`${conversationsTable.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(conversationsTable.id, conversation.id));

  const eventPayload = {
    conversationId: conversation.id,
    contactId,
    channelAccountId: channelAccount.id,
    providerMessageId: params.providerMessageId,
    channelType: params.channelType,
  };

  await db.insert(domainEventsTable).values({
    workspaceId,
    eventType: "message.received",
    entityType: "message",
    entityId: message.id,
    payload: eventPayload,
  });

  emitWorkspaceEvent({
    workspaceId,
    type: "message.received",
    entityType: "message",
    entityId: message.id,
    payload: eventPayload,
  });

  return true;
}
