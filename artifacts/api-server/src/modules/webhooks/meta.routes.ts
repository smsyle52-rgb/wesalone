import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
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
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { handleMetaWebhook } from "../integrations/meta-webhook.handler";

type RequestWithRawBody = Request & { rawBody?: Buffer };

type MetaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  senderType?: string;
  type?: string;
  text?: { body?: string };
  [key: string]: unknown;
};

type MetaMediaField = {
  id?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
  [key: string]: unknown;
};

type MetaStatus = {
  recipient_id?: string;
  [key: string]: unknown;
};

type MetaChangeValue = {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  [key: string]: unknown;
};

type MetaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: MetaChangeValue;
    }>;
  }>;
};

type ChannelAccount = typeof channelAccountsTable.$inferSelect;
type Contact = typeof contactsTable.$inferSelect;
type Conversation = typeof conversationsTable.$inferSelect;

const router = Router();

function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return queryString(value[0]);
  return undefined;
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/[^\d+]/g, "");
}

const MEDIA_LABELS: Record<string, string> = {
  image: "صورة",
  audio: "رسالة صوتية",
  voice: "رسالة صوتية",
  video: "فيديو",
  document: "مستند",
  sticker: "ملصق",
};

function extractMedia(message: MetaMessage): { content: string; attachments: object[] } | null {
  const type = message.type;
  if (!type || type === "text") return null;
  const raw = message[type];
  const field: MetaMediaField = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as MetaMediaField)
    : {};
  const caption = typeof field.caption === "string" ? field.caption.trim() : "";
  const label = MEDIA_LABELS[type] ?? "وسائط";
  return {
    content: caption || `[${label}]`,
    attachments: [{
      type: type === "voice" ? "audio" : type,
      provider: "whatsapp",
      media_id: typeof field.id === "string" ? field.id : undefined,
      mime_type: typeof field.mime_type === "string" ? field.mime_type : null,
      caption: caption || null,
      ...(type === "document" && typeof field.filename === "string" ? { filename: field.filename } : {}),
    }],
  };
}

function getRawBody(req: RequestWithRawBody): Buffer {
  if (req.rawBody) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

function parsePayload(req: RequestWithRawBody, rawBody: Buffer): MetaPayload {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body as MetaPayload;
  }
  return JSON.parse(rawBody.toString("utf8")) as MetaPayload;
}

// Structure-only summary (no message text/PII) to diagnose IG/Messenger webhooks that arrive but
// store nothing — reveals payload shape (messaging[] vs changes[]) and the recipient/account id.
function describeMetaPayload(payload: any): Record<string, unknown> {
  const entry = Array.isArray(payload?.entry) ? payload.entry[0] : undefined;
  const messaging = Array.isArray(entry?.messaging) ? entry.messaging[0] : undefined;
  const change = Array.isArray(entry?.changes) ? entry.changes[0] : undefined;
  return {
    object: payload?.object,
    entryKeys: entry ? Object.keys(entry) : [],
    hasMessaging: Array.isArray(entry?.messaging),
    hasChanges: Array.isArray(entry?.changes),
    messagingKeys: messaging ? Object.keys(messaging) : [],
    messageKeys: messaging?.message ? Object.keys(messaging.message) : [],
    changeField: change?.field,
    recipientId: messaging?.recipient?.id ?? change?.value?.recipient?.id ?? entry?.id,
  };
}

function verifyMetaSignature(req: Request, rawBody: Buffer): boolean {
  const secret = env.META_APP_SECRET ?? env.META_WEBHOOK_SECRET;
  const signature = req.header("x-hub-signature-256");
  if (!secret || !signature?.startsWith("sha256=")) return false;

  const signatureHex = signature.slice("sha256=".length);
  if (!/^[a-fA-F0-9]+$/.test(signatureHex)) return false;

  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(signatureHex, "hex");

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function findWhatsappChannel(phoneNumberId: string): Promise<ChannelAccount | undefined> {
  const [channel] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      sql`${channelAccountsTable.channelType} in ('whatsapp', 'whatsapp_api')`,
      sql`(
        ${channelAccountsTable.providerConfig}->>'phone_number_id' = ${phoneNumberId}
        OR ${channelAccountsTable.providerConfig}->>'phoneNumberId' = ${phoneNumberId}
      )`,
    ))
    .limit(1);

  return channel;
}

async function upsertContact(workspaceId: string, phone: string): Promise<Contact> {
  const normalizedPhone = normalizePhone(phone);

  const [existingChannel] = await db
    .select({ contactId: contactChannelsTable.contactId })
    .from(contactChannelsTable)
    .where(and(
      eq(contactChannelsTable.workspaceId, workspaceId),
      sql`${contactChannelsTable.channelType} in ('phone', 'whatsapp', 'whatsapp_api')`,
      eq(contactChannelsTable.normalizedIdentifier, normalizedPhone),
    ))
    .limit(1);

  if (existingChannel) {
    const [contact] = await db
      .update(contactsTable)
      .set({ lastContactedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(contactsTable.id, existingChannel.contactId),
        eq(contactsTable.workspaceId, workspaceId),
      ))
      .returning();
    if (contact) {
      await db
        .insert(contactChannelsTable)
        .values({
          workspaceId,
          contactId: contact.id,
          channelType: "whatsapp",
          identifier: normalizedPhone,
          normalizedIdentifier: normalizedPhone,
          isPrimary: true,
          isVerified: true,
          optedIn: true,
          providerData: { externalId: phone },
        })
        .onConflictDoNothing();
      return contact;
    }
  }

  const [existingContact] = await db
    .select()
    .from(contactsTable)
    .where(and(
      eq(contactsTable.workspaceId, workspaceId),
      eq(contactsTable.phone, normalizedPhone),
    ))
    .limit(1);

  const contact = existingContact ?? (await db
    .insert(contactsTable)
    .values({
      workspaceId,
      name: normalizedPhone,
      phone: normalizedPhone,
      lastContactedAt: new Date(),
    })
    .returning())[0];

  if (!contact) {
    throw new Error("Failed to upsert Meta webhook contact");
  }

  if (existingContact) {
    await db
      .update(contactsTable)
      .set({ lastContactedAt: new Date(), updatedAt: new Date() })
      .where(eq(contactsTable.id, existingContact.id));
  }

  await db
    .insert(contactChannelsTable)
    .values({
      workspaceId,
      contactId: contact.id,
      channelType: "whatsapp",
      identifier: normalizedPhone,
      normalizedIdentifier: normalizedPhone,
      isPrimary: true,
      isVerified: true,
      optedIn: true,
      providerData: { externalId: phone },
    })
    .onConflictDoNothing();

  return contact;
}

async function findConversation(
  workspaceId: string,
  channelAccountId: string,
  externalThreadId: string,
): Promise<Conversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.workspaceId, workspaceId),
      eq(conversationsTable.channelAccountId, channelAccountId),
      eq(conversationsTable.externalThreadId, externalThreadId),
    ))
    .orderBy(desc(conversationsTable.createdAt))
    .limit(1);

  return conversation;
}

async function upsertConversation(
  channel: ChannelAccount,
  contactId: string,
  externalThreadId: string,
  lastMessage: string,
): Promise<Conversation> {
  const existing = await findConversation(channel.workspaceId, channel.id, externalThreadId);
  const now = new Date();

  if (existing) {
    const [conversation] = await db
      .update(conversationsTable)
      .set({
        contactId,
        lastMessage,
        lastMessageAt: now,
        unreadCount: sql`${conversationsTable.unreadCount} + 1`,
        consecutiveAgentReplies: 0,
        updatedAt: now,
      })
      .where(eq(conversationsTable.id, existing.id))
      .returning();
    return conversation ?? existing;
  }

  const [conversation] = await db
    .insert(conversationsTable)
    .values({
      workspaceId: channel.workspaceId,
      contactId,
      channelAccountId: channel.id,
      externalThreadId,
      channel: "whatsapp_api",
      status: "open",
      priority: "normal",
      lastMessage,
      lastMessageAt: now,
      unreadCount: 1,
    })
    .returning();

  if (!conversation) {
    throw new Error("Failed to upsert Meta webhook conversation");
  }

  return conversation;
}

async function insertInboundMessage(
  conversation: Conversation,
  message: MetaMessage,
  content: string,
  attachments: object[] = [],
): Promise<string | undefined> {
  if (message.id) {
    const [existingMessage] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.workspaceId, conversation.workspaceId),
        eq(messagesTable.providerMessageId, message.id),
      ))
      .limit(1);
    if (existingMessage) return undefined;
  }

  const sentAt = message.timestamp && /^\d+$/.test(message.timestamp)
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();

  const [created] = await db
    .insert(messagesTable)
    .values({
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      providerMessageId: message.id,
      direction: "inbound",
      senderType: "customer",
      source: "whatsapp_api",
      content,
      attachments,
      deliveryStatus: "delivered",
      providerPayload: message,
      sentAt,
    })
    .returning({ id: messagesTable.id });

  return created?.id;
}

async function createDomainEvent(params: {
  workspaceId: string;
  eventType: string;
  entityId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.insert(domainEventsTable).values({ ...params, entityType: "conversation" });
}

async function handleInboundMessage(value: MetaChangeValue, message: MetaMessage): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  const from = message.from;

  // PD-3 fix: استخرج محتوى الوسائط (صورة/صوت/فيديو/مستند) لا تتجاهل الرسالة
  const textContent = message.text?.body?.trim();
  const media = textContent ? null : extractMedia(message);
  const content = textContent ?? media?.content;
  const attachments = media?.attachments ?? [];

  if (!phoneNumberId || !from || !content) {
    logger.warn({ phoneNumberId, from, messageId: message.id, type: message.type }, "Skipping incomplete Meta inbound message");
    return;
  }

  const channel = await findWhatsappChannel(phoneNumberId);
  if (!channel) {
    logger.warn({ phoneNumberId }, "No WhatsApp channel account found for Meta webhook message");
    return;
  }

  const contact = await upsertContact(channel.workspaceId, from);
  const conversation = await upsertConversation(channel, contact.id, from, content);
  const messageId = await insertInboundMessage(conversation, message, content, attachments);
  if (!messageId) {
    logger.info({ providerMessageId: message.id, conversationId: conversation.id }, "Skipping duplicate Meta message");
    return;
  }

  await createDomainEvent({
    workspaceId: channel.workspaceId,
    eventType: "message.received",
    entityId: conversation.id,
    payload: { channelAccountId: channel.id, messageId },
  });
}

async function handleEchoEvent(value: MetaChangeValue, externalThreadId: string | undefined): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId || !externalThreadId) return;

  const channel = await findWhatsappChannel(phoneNumberId);
  if (!channel) {
    logger.warn({ phoneNumberId }, "No WhatsApp channel account found for Meta webhook echo");
    return;
  }

  const conversation = await findConversation(channel.workspaceId, channel.id, externalThreadId);
  if (!conversation) return;

  await createDomainEvent({
    workspaceId: channel.workspaceId,
    eventType: "message.echo",
    entityId: conversation.id,
    payload: { channelAccountId: channel.id },
  });
}

async function handleMetaPayload(payload: MetaPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const message of value.messages ?? []) {
        if (message.senderType === "business") {
          await handleEchoEvent(value, message.from);
          continue;
        }

        await handleInboundMessage(value, message);
      }
    }
  }
}

router.get("/meta", (req: Request, res: Response) => {
  const mode = queryString(req.query["hub.mode"]);
  const verifyToken = queryString(req.query["hub.verify_token"]);
  const challenge = queryString(req.query["hub.challenge"]);
  const expectedVerifyToken = env.META_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === "subscribe"
    && Boolean(expectedVerifyToken)
    && verifyToken === expectedVerifyToken
    && challenge !== undefined
  ) {
    res.type("text/plain").send(challenge);
    return;
  }

  res.sendStatus(403);
});

router.post("/meta", express.raw({ type: "*/*", limit: "2mb" }), async (req: RequestWithRawBody, res: Response) => {
  const rawBody = getRawBody(req);

  if (!verifyMetaSignature(req, rawBody)) {
    logger.warn({ path: req.path }, "Meta webhook signature verification failed");
    res.status(200).send("EVENT_RECEIVED");
    return;
  }

  try {
    const payload = parsePayload(req, rawBody);
    // PD-6 fix: route instagram/page (Messenger) webhooks to the shared dispatcher
    const objectType = (payload as any)?.object;
    if (objectType === "instagram" || objectType === "page") {
      const result = await handleMetaWebhook(payload);
      if (result.messagesCreated === 0) {
        logger.warn({ webhook: describeMetaPayload(payload) }, "Meta IG/Messenger webhook stored no messages");
      }
    } else {
      await handleMetaPayload(payload);
    }
  } catch (err) {
    logger.error({ err }, "Failed to process Meta webhook");
  }

  res.status(200).send("EVENT_RECEIVED");
});

export default router;
