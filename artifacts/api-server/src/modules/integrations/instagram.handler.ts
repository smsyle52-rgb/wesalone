import { extractMetaMessagingContent, ingestMetaChannelMessage } from "./meta-channel-ingest";

// Instagram messaging arrives in two shapes depending on the app setup:
//  - New Instagram API (Instagram login): Messenger-style `entry[].messaging[]`
//  - Legacy (Graph/Facebook login): `entry[].changes[]` with field "messages"
// We handle both so a connected account works regardless of which the Meta app emits.
export async function handleInstagramWebhook(payload: unknown): Promise<number> {
  const body = payload as any;
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  let messagesCreated = 0;

  for (const entry of entries) {
    // ── New format: entry.messaging[] (milliseconds timestamps) ──
    const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const event of messagingEvents) {
      if (event?.message?.is_echo) continue; // skip our own outbound echoes
      const { text, attachments } = extractMetaMessagingContent(event?.message, "instagram");
      if (!text) continue; // لا نص ولا مرفق مدعوم (مثلاً مشاركة قالب/رابط) — لا شيء نعرضه فعلاً

      const senderId = event?.sender?.id;
      const igAccountId = event?.recipient?.id ?? entry.id;
      const providerMessageId = event?.message?.mid ?? event?.message?.id;
      const timestamp = Number(event?.timestamp);

      const created = await ingestMetaChannelMessage({
        channelType: "instagram",
        source: "instagram",
        accountConfigKey: "igAccountId",
        accountConfigValue: String(igAccountId ?? ""),
        senderId: String(senderId ?? ""),
        providerMessageId: String(providerMessageId ?? ""),
        text,
        attachments,
        timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null,
        providerPayload: event.message,
      });
      if (created) messagesCreated += 1;
    }

    // ── Legacy format: entry.changes[] field "messages" (seconds timestamps) ──
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "messages") continue;
      const value = change?.value ?? {};
      const message = value.message ?? value.messages?.[0] ?? value;
      const { text, attachments } = extractMetaMessagingContent(message, "instagram");
      if (!text) continue; // لا نص ولا مرفق مدعوم

      const senderId = value.sender?.id ?? message?.from?.id ?? message?.sender?.id ?? value.from?.id;
      const igAccountId = value.recipient?.id ?? entry.id;
      const providerMessageId = message?.mid ?? message?.id ?? value.message_id;
      const timestamp = Number(value.timestamp ?? message?.timestamp ?? entry.time);

      const created = await ingestMetaChannelMessage({
        channelType: "instagram",
        source: "instagram",
        accountConfigKey: "igAccountId",
        accountConfigValue: String(igAccountId ?? ""),
        senderId: String(senderId ?? ""),
        providerMessageId: String(providerMessageId ?? ""),
        text,
        attachments,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        providerPayload: message,
      });
      if (created) messagesCreated += 1;
    }
  }

  return messagesCreated;
}
