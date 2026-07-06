import { createDecipheriv, createHash } from "node:crypto";
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
import { notifyWorkspace } from "../../services/notifications";

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
  // 6 يوليو 2026: رسائل بلا نص (صورة/ملصق/ملف/صوت بلا كابشن) كانت تُسقَط بصمت في طبقة الاستدعاء
  // قبل الوصول هنا حتى (فحص !text.trim() في الأعلى) — العميل يرسل ولا يظهر شيء إطلاقاً بالوارد.
  // المرفقات تسمح بإدراج الرسالة حتى بلا نص، مطابقةً لما هو مُثبَت فعلاً لواتساب في meta.routes.ts.
  attachments?: object[];
};

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v22.0";

// 6 يوليو 2026: رسائل ماسنجر/إنستغرام بلا نص عادي (صورة/ملصق/فيديو/صوت/ملف بلا كابشن) كانت
// تُسقَط بصمت تامة عند المصدر (فحص !text.trim() فقط) — العميل يرسل ولا يظهر شيء إطلاقاً بالوارد
// ("رسائل الماسنجر أحياناً لا تدخل منصتنا"). مشتركة بين الحالبين لأن شكل attachments[] من Meta
// (type + payload.url) واحد للقناتين — مطابقة لنمط واتساب المُثبَت (meta.routes.ts: extractMedia).
// المفتاح = نوع Meta الخام (attachment.type من webhook ماسنجر/إنستغرام). القيمة = [نوعنا الموحّد
// (مطابق لما تتوقّعه agent-reply.ts/agent-media.ts عبر القنوات كلها)، تسمية عربية للنص البديل].
const META_MESSAGING_MEDIA_TYPES: Record<string, [type: string, label: string]> = {
  image: ["image", "صورة"],
  video: ["video", "فيديو"],
  audio: ["audio", "رسالة صوتية"],
  file: ["document", "ملف"], // Meta يسمّيه "file"؛ نوحّده لـ"document" كواتساب.
};

export function extractMetaMessagingContent(
  message: unknown,
  provider: "messenger" | "instagram",
): { text: string; attachments: object[] } {
  const msg = (message ?? {}) as { text?: unknown; attachments?: unknown };
  const rawText = typeof msg.text === "string" ? msg.text.trim() : "";
  const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];

  const mediaAttachments = rawAttachments
    .filter((att): att is { type: string; payload?: { url?: unknown } } =>
      !!att && typeof att === "object" && typeof (att as { type?: unknown }).type === "string"
      && META_MESSAGING_MEDIA_TYPES[(att as { type: string }).type] !== undefined)
    .map((att) => ({
      type: META_MESSAGING_MEDIA_TYPES[att.type][0],
      provider,
      url: typeof att.payload?.url === "string" ? att.payload.url : undefined,
    }));

  if (rawText) return { text: rawText, attachments: mediaAttachments };
  if (mediaAttachments.length > 0) {
    const rawType = String((rawAttachments[0] as { type?: string })?.type ?? "");
    const label = META_MESSAGING_MEDIA_TYPES[rawType]?.[1] ?? "وسائط";
    return { text: `[${label}]`, attachments: mediaAttachments };
  }
  return { text: "", attachments: [] };
}

// Decrypt the per-channel page token (enc:v1:) so we can read the sender's public profile.
function decryptTokenRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith("enc:v1:")) return null;
  const secret = process.env.META_OAUTH_STATE_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const parts = ref.split(":");
    if (parts.length !== 5) return null;
    const key = createHash("sha256").update(secret).digest();
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const data = Buffer.from(parts[4], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Best-effort display name from Meta (page token). Falls back to null so callers keep a placeholder.
async function fetchMetaContactName(
  channelType: MetaChannelType,
  senderId: string,
  credentialsSecretRef: string | null,
): Promise<string | null> {
  const token = decryptTokenRef(credentialsSecretRef) ?? process.env.META_SYSTEM_USER_TOKEN ?? process.env.META_ACCESS_TOKEN;
  if (!token || !senderId) return null;
  const fields = channelType === "instagram" ? "name,username" : "first_name,last_name";
  try {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${senderId}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (channelType === "instagram") {
      const name = typeof data?.name === "string" ? data.name.trim() : "";
      const username = typeof data?.username === "string" ? data.username.trim() : "";
      return name || (username ? `@${username}` : null);
    }
    const full = [data?.first_name, data?.last_name]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" ")
      .trim();
    return full || null;
  } catch {
    return null;
  }
}

async function findChannelAccount(
  channelType: MetaChannelType,
  configKey: "igAccountId" | "pageId",
  configValue: string,
) {
  // P0 isolation fix: only ACTIVE accounts may route inbound traffic, and an
  // identifier shared by more than one active account is refused outright —
  // picking an arbitrary row could deliver a customer's message to the wrong
  // workspace. Partial unique indexes (migrate-phase345.sql) make this state
  // impossible going forward; this guard is defense-in-depth.
  const accounts = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.channelType, channelType),
      eq(channelAccountsTable.status, "active"),
      sql`${channelAccountsTable.providerConfig}->>${configKey} = ${configValue}`,
    ))
    .limit(2);

  if (accounts.length > 1) {
    logger.error(
      {
        severity: "CRITICAL",
        alert: "channel.identifier_conflict",
        channelType,
        accountConfigKey: configKey,
        accountConfigValue: configValue,
        channelAccountIds: accounts.map((a) => a.id),
        workspaceIds: accounts.map((a) => a.workspaceId),
      },
      "Multiple active channel accounts share one provider identifier — refusing to route (tenant-isolation guard)",
    );
    return null;
  }

  return accounts[0] ?? null;
}

export async function ingestMetaChannelMessage(params: IngestMetaChannelMessageParams): Promise<boolean> {
  const hasAttachments = Array.isArray(params.attachments) && params.attachments.length > 0;
  if (!params.providerMessageId || !params.senderId || (!params.text.trim() && !hasAttachments)) return false;

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
    const fetchedName = await fetchMetaContactName(params.channelType, normalizedIdentifier, channelAccount.credentialsSecretRef);
    const [contact] = await db
      .insert(contactsTable)
      .values({
        workspaceId,
        name: fetchedName ?? `${params.channelType}:${normalizedIdentifier}`,
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
  // P0 idempotency fix: the duplicate check above is only a fast path — two
  // concurrent deliveries of the same webhook can both pass it. The partial
  // unique index uq_messages_ws_provider_message (migrate-phase345.sql) plus
  // ON CONFLICT DO NOTHING makes the duplicate insert a no-op, and we bail out
  // before touching counters or emitting events (no duplicate agent reply).
  const [message] = await db
    .insert(messagesTable)
    .values({
      workspaceId,
      conversationId: conversation.id,
      providerMessageId: params.providerMessageId,
      direction: "inbound",
      senderType: "contact",
      source: params.source,
      contentType: hasAttachments ? "media" : "text",
      content: params.text,
      attachments: params.attachments ?? [],
      providerPayload: params.providerPayload,
      deliveryStatus: "received",
      sentAt,
    })
    .onConflictDoNothing()
    .returning();

  if (!message) return false;

  const lastMessagePreview = params.text.trim() || (hasAttachments ? params.text : "");
  await db.update(conversationsTable)
    .set({
      lastMessage: lastMessagePreview.slice(0, 120),
      lastMessageAt: sentAt,
      unreadCount: sql`${conversationsTable.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(conversationsTable.id, conversation.id), eq(conversationsTable.workspaceId, workspaceId)));

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

  await notifyWorkspace({
    workspaceId,
    type: "message.received",
    titleAr: "رسالة جديدة",
    bodyAr: `وصلت رسالة جديدة عبر ${params.channelType}.`,
    link: `/inbox?conversation=${conversation.id}`,
  });

  return true;
}
