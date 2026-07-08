import express, { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  channelAccountsTable,
  contactsTable,
  conversationsTable,
  db,
  domainEventsTable,
  messagesTable,
  outboxEventsTable,
} from "@workspace/db";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import { verifyMetaHmac } from "../../lib/meta-signature";
import { extractMetaCommerceMessage } from "../integrations/meta-commerce-message";
import { handleMetaWebhook } from "../integrations/meta-webhook.handler";
import { ingestWebhookEvent } from "../integrations/webhookIngest.service";
import { notifyWorkspace } from "../../services/notifications";
import { businessScopeFromProviderConfig, resolveWhatsAppInboundContact } from "../integrations/whatsapp-contact-identity";
import { writeAgentStatus } from "../conversations/lifecycle";

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
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
  [key: string]: unknown;
};

type MetaCall = {
  id?: string;
  from?: string;
  timestamp?: string;
  event?: string;
  [key: string]: unknown;
};

type MetaChangeValue = {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
  calls?: MetaCall[];
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
type Conversation = typeof conversationsTable.$inferSelect;

const router = Router();

function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return queryString(value[0]);
  return undefined;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "صورة",
  audio: "رسالة صوتية",
  voice: "رسالة صوتية",
  video: "فيديو",
  document: "مستند",
  sticker: "ملصق",
};

// 6 يوليو 2026: تفاعل واتساب (👍 على رسالة سابقة) كان يمرّ في المسار العام أدناه فيُخزَّن
// كأنه مرفق وسائط قابل للتحميل (attachments:[{type:"reaction", mime_type:null, ...}]) رغم
// عدم وجود أي ملف حقيقي وراءه — الواجهة تحاول جلبه فتفشل بحلقة 401/404 متكررة (شكوى "الوارد
// يعلّق"). لا مرفق إطلاقاً لتفاعل — نص فقط، وسلسلة فارغة تعني إزالة التفاعل.
function extractReactionText(message: MetaMessage): string {
  const reaction = message.reaction as { emoji?: string } | undefined;
  const emoji = typeof reaction?.emoji === "string" ? reaction.emoji.trim() : "";
  return emoji ? `[تفاعل: ${emoji}]` : "[أزال تفاعله عن رسالة سابقة]";
}

function extractMedia(message: MetaMessage): { content: string; attachments: object[] } | null {
  const type = message.type;
  if (!type || type === "text") return null;
  if (type === "reaction") return { content: extractReactionText(message), attachments: [] };
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
  return verifyMetaHmac(rawBody, req.header("x-hub-signature-256"), secret ?? "");
}

async function findWhatsappChannel(phoneNumberId: string): Promise<ChannelAccount | undefined> {
  // P0 isolation fix: only ACTIVE accounts may route inbound traffic, and an
  // identifier shared by more than one active account is refused outright —
  // picking an arbitrary row here could deliver a customer's message to the
  // wrong workspace. A partial unique index (migrate-phase345.sql) makes this
  // state impossible going forward; this guard is defense-in-depth.
  const channels = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      sql`${channelAccountsTable.channelType} in ('whatsapp', 'whatsapp_api')`,
      eq(channelAccountsTable.status, "active"),
      sql`(
        ${channelAccountsTable.providerConfig}->>'phone_number_id' = ${phoneNumberId}
        OR ${channelAccountsTable.providerConfig}->>'phoneNumberId' = ${phoneNumberId}
      )`,
    ))
    // Merge note (2 Jul): main's hotfix picked the newest row on duplicates
    // (orderBy updatedAt, limit 1) — that silently routes to an arbitrary
    // tenant. The fail-closed guard below wins: refuse + CRITICAL alert, and
    // the partial unique index makes the duplicate state impossible anyway.
    .limit(2);

  if (channels.length > 1) {
    logger.error(
      {
        severity: "CRITICAL",
        alert: "channel.identifier_conflict",
        phoneNumberId,
        channelAccountIds: channels.map((c) => c.id),
        workspaceIds: channels.map((c) => c.workspaceId),
      },
      "Multiple active WhatsApp channel accounts share one phone_number_id — refusing to route (tenant-isolation guard)",
    );
    return undefined;
  }

  return channels[0];
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

async function getOrCreateConversation(
  channel: ChannelAccount,
  contactId: string,
  externalThreadId: string,
  contactChannelId: string | null = null,
): Promise<Conversation> {
  const existing = await findConversation(channel.workspaceId, channel.id, externalThreadId);
  if (existing) return existing;

  const [conversation] = await db
    .insert(conversationsTable)
    .values({
      workspaceId: channel.workspaceId,
      contactId,
      contactChannelId,
      channelAccountId: channel.id,
      externalThreadId,
      channel: "whatsapp_api",
      status: "open",
      priority: "normal",
      unreadCount: 0,
    })
    .returning();

  if (!conversation) {
    throw new Error("Failed to upsert Meta webhook conversation");
  }

  return conversation;
}

// P0 idempotency fix: counters and last-message move AFTER a successful
// non-duplicate message insert, so a Meta webhook retry can no longer inflate
// unread_count, bump lastMessage, or reset the agent anti-loop counter for a
// message that was deduplicated away.
async function bumpConversationOnInbound(
  conversation: Conversation,
  contactId: string,
  lastMessage: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(conversationsTable)
    .set({
      contactId,
      lastMessage,
      lastMessageAt: now,
      unreadCount: sql`${conversationsTable.unreadCount} + 1`,
      consecutiveAgentReplies: 0,
      updatedAt: now,
    })
    .where(and(
      eq(conversationsTable.id, conversation.id),
      eq(conversationsTable.workspaceId, conversation.workspaceId),
    ));
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

  // P0 idempotency fix: the select above is only a fast path — two concurrent
  // deliveries of the same webhook can both pass it. The partial unique index
  // uq_messages_ws_provider_message (migrate-phase345.sql) plus ON CONFLICT DO
  // NOTHING makes the duplicate insert a no-op; the caller sees `undefined`
  // and skips counters + domain event (no duplicate agent reply).
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
    .onConflictDoNothing()
    .returning({ id: messagesTable.id });

  return created?.id;
}

async function createDomainEvent(params: {
  workspaceId: string;
  eventType: string;
  entityId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  await db.insert(domainEventsTable).values({ ...params, entityType: "conversation" });
}

async function handleInboundMessage(value: MetaChangeValue, message: MetaMessage, correlationId: string): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;

  // PD-3 fix: استخرج محتوى الوسائط (صورة/صوت/فيديو/مستند) لا تتجاهل الرسالة
  const textContent = message.text?.body?.trim();
  const structured = textContent ? null : extractMetaCommerceMessage(message, "whatsapp");
  const media = textContent || structured ? null : extractMedia(message);
  const content = textContent ?? structured?.content ?? media?.content;
  const attachments = structured?.attachments ?? media?.attachments ?? [];

  if (!phoneNumberId || !content) {
    logger.warn({ phoneNumberId, hasFrom: Boolean(message.from), messageId: message.id, type: message.type }, "Skipping incomplete Meta inbound message");
    return;
  }

  const channel = await findWhatsappChannel(phoneNumberId);
  if (!channel) {
    logger.warn({ phoneNumberId }, "No WhatsApp channel account found for Meta webhook message");
    return;
  }

  const contactResolution = await resolveWhatsAppInboundContact({
    workspaceId: channel.workspaceId,
    channelAccountId: channel.id,
    phoneNumberId,
    businessScopeId: businessScopeFromProviderConfig(channel.providerConfig as Record<string, unknown>),
    value,
    message,
  });
  if (!contactResolution) {
    logger.warn({
      phoneNumberId,
      messageId: message.id,
      messageKeys: Object.keys(message),
      hasContacts: Array.isArray(value.contacts),
    }, "Skipping WhatsApp inbound message without a resolvable customer identity");
    return;
  }

  const conversation = await getOrCreateConversation(
    channel,
    contactResolution.contactId,
    contactResolution.externalThreadId,
    contactResolution.contactChannelId,
  );
  const messageId = await insertInboundMessage(conversation, message, content, attachments);
  if (!messageId) {
    logger.info({ providerMessageId: message.id, conversationId: conversation.id }, "Skipping duplicate Meta message");
    return;
  }

  await bumpConversationOnInbound(conversation, contactResolution.contactId, content);

  await createDomainEvent({
    workspaceId: channel.workspaceId,
    eventType: "message.received",
    entityId: conversation.id,
    payload: {
      channelAccountId: channel.id,
      conversationId: conversation.id,
      contactId: contactResolution.contactId,
      messageId,
      recipientIdentityType: contactResolution.recipientIdentityType,
    },
    correlationId,
  });
}

async function handleEchoEvent(value: MetaChangeValue, externalThreadId: string | undefined, correlationId: string): Promise<void> {
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
    correlationId,
  });
}

// W4-T1: reconcile Meta's outbound delivery receipts (sent/delivered/read/failed)
// onto messages.delivery_status. Workspace-scoped via the same channel lookup as inbound.
async function handleStatusUpdate(value: MetaChangeValue, status: MetaStatus): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  const providerMessageId = status.id;
  const deliveryStatus = status.status;
  if (!phoneNumberId || !providerMessageId || !deliveryStatus) return;

  const channel = await findWhatsappChannel(phoneNumberId);
  if (!channel) {
    logger.warn({ phoneNumberId }, "No WhatsApp channel account found for Meta status webhook");
    return;
  }

  const updated = await db
    .update(messagesTable)
    .set({ deliveryStatus })
    .where(and(
      eq(messagesTable.workspaceId, channel.workspaceId),
      eq(messagesTable.providerMessageId, providerMessageId),
    ))
    .returning({ id: messagesTable.id });

  if (updated.length === 0) return;

  if (deliveryStatus === "failed" && status.errors?.length) {
    logger.warn({ providerMessageId, workspaceId: channel.workspaceId, errors: status.errors }, "WhatsApp delivery failed");
  }
}

// PD-5 (نطاق 25): WhatsApp Calling MVP. We do not answer voice (no WebRTC/STT/TTS); instead we log
// the incoming call, escalate to a human, and send a fixed text inviting the customer to message.
// Dormant until the WhatsApp number has Calling enabled and the `calls` webhook field is subscribed.
async function handleInboundCall(value: MetaChangeValue, call: MetaCall): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  const from = typeof call?.from === "string" ? call.from : "WhatsApp customer";
  const callId = typeof call?.id === "string" ? call.id : undefined;
  const event = typeof call?.event === "string" ? call.event : undefined;

  // Structure-only diagnostic (no PII) — the WhatsApp Calling payload shape can vary by rollout.
  logger.info({ phoneNumberId, callId, event, callKeys: call ? Object.keys(call) : [] }, "WhatsApp call webhook received");

  if (!phoneNumberId || !callId) {
    logger.warn({ phoneNumberId, callId }, "Skipping incomplete WhatsApp call event");
    return;
  }

  const channel = await findWhatsappChannel(phoneNumberId);
  if (!channel) {
    logger.warn({ phoneNumberId }, "No WhatsApp channel account found for call event");
    return;
  }

  const contactResolution = await resolveWhatsAppInboundContact({
    workspaceId: channel.workspaceId,
    channelAccountId: channel.id,
    phoneNumberId,
    businessScopeId: businessScopeFromProviderConfig(channel.providerConfig as Record<string, unknown>),
    value,
    message: call,
  });
  if (!contactResolution) {
    logger.warn({ phoneNumberId, callId }, "Skipping WhatsApp call without a resolvable customer identity");
    return;
  }
  const content = "📞 مكالمة واتساب واردة";
  const conversation = await getOrCreateConversation(
    channel,
    contactResolution.contactId,
    contactResolution.externalThreadId,
    contactResolution.contactChannelId,
  );

  // Log the call (dedup by call id). We intentionally do NOT emit message.received: the AI must not
  // "answer" a voice call — we escalate to a human and send a fixed text instead.
  const timestamp = call?.timestamp != null ? String(call.timestamp) : undefined;
  const messageId = await insertInboundMessage(conversation, { id: callId, timestamp }, content);
  if (!messageId) return; // duplicate call event

  await bumpConversationOnInbound(conversation, contactResolution.contactId, content);

  await writeAgentStatus({
    conversationId: conversation.id,
    workspaceId: channel.workspaceId,
    agentStatus: "human",
    extraFields: { needsHuman: true, escalationReason: "whatsapp_call" },
  });

  // Fixed auto-reply within the 24h customer window (the customer just initiated contact by calling).
  await db.insert(outboxEventsTable).values({
    workspaceId: channel.workspaceId,
    eventType: "message.send.whatsapp.text",
    entityType: "conversation",
    entityId: conversation.id,
    idempotencyKey: `call-autoreply:${callId}`,
    payload: {
      channelAccountId: channel.id,
      conversationId: conversation.id,
      to: contactResolution.externalThreadId,
      recipientIdentityType: contactResolution.recipientIdentityType,
      text: "شكراً لتواصلك! لا نستقبل المكالمات حالياً، لكن اكتب رسالتك هنا وسنردّ عليك فوراً. 🌟",
    },
    status: "pending",
    nextAttemptAt: new Date(),
  }).onConflictDoNothing();

  await notifyWorkspace({
    workspaceId: channel.workspaceId,
    type: "message.received",
    titleAr: "مكالمة واتساب واردة",
    bodyAr: `حاول ${from} الاتصال عبر واتساب — تابع المحادثة نصياً.`,
    link: `/inbox?conversation=${conversation.id}`,
  });
}

async function handleMetaPayload(payload: MetaPayload, correlationId: string): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const message of value.messages ?? []) {
        if (message.senderType === "business") {
          await handleEchoEvent(value, message.from, correlationId);
          continue;
        }

        await handleInboundMessage(value, message, correlationId);
      }

      for (const call of value.calls ?? []) {
        await handleInboundCall(value, call);
      }

      for (const status of value.statuses ?? []) {
        await handleStatusUpdate(value, status);
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
    // 401, not 200: a bad signature is either a forged request or OUR secret is
    // misconfigured. Returning 200 makes Meta count the event as delivered and
    // never retry — a silent total message loss if the secret ever drifts.
    // With 401 Meta retries and surfaces delivery errors in the app dashboard.
    logger.warn({ path: req.path }, "Meta webhook signature verification failed");
    res.sendStatus(401);
    return;
  }

  const payload = (() => { try { return parsePayload(req, rawBody); } catch { return null; } })();
  if (!payload) {
    res.status(200).send("EVENT_RECEIVED");
    return;
  }

  // W2-T1: fast-ack path — persist raw event, skip inline processing
  if (env.INGEST_DEFERRED) {
    const correlationId = randomUUID();
    try {
      const result = await ingestWebhookEvent({ provider: "meta", headers: req.headers, payload, correlationId });
      const webhookEventId = "event" in result ? result.event?.id : undefined;
      logger.info(
        { correlationId, webhookEventId, duplicate: result.duplicate },
        "Persisted deferred Meta webhook event",
      );
    } catch (err) {
      logger.error({ err, correlationId }, "Failed to persist deferred webhook_events row");
      res.status(500).send("INGEST_FAILED");
      return;
    }
    res.status(200).send("EVENT_RECEIVED");
    return;
  }

  const correlationId = randomUUID();
  try {
    // PD-6 fix: route instagram/page (Messenger) webhooks to the shared dispatcher
    const objectType = (payload as any)?.object;
    if (objectType === "instagram" || objectType === "page") {
      const result = await handleMetaWebhook(payload);
      if (result.messagesCreated === 0) {
        logger.warn({ webhook: describeMetaPayload(payload), correlationId }, "Meta IG/Messenger webhook stored no messages");
      }
    } else {
      await handleMetaPayload(payload, correlationId);
    }
  } catch (err) {
    logger.error({ err, correlationId }, "Failed to process Meta webhook");
  }

  res.status(200).send("EVENT_RECEIVED");
});

export default router;
