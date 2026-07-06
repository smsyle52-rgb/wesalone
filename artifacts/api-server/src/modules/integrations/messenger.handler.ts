import { logger } from "../../lib/logger";
import { extractMetaMessagingContent, ingestMetaChannelMessage } from "./meta-channel-ingest";

export async function handleMessengerWebhook(payload: unknown): Promise<number> {
  const body = payload as any;
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  let messagesCreated = 0;

  for (const entry of entries) {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const event of events) {
      if (event?.message?.is_echo) continue; // skip our own outbound echoes
      const { text, attachments } = extractMetaMessagingContent(event?.message, "messenger");
      if (!text) {
        // لا نص ولا مرفق مدعوم (مثلاً: مشاركة قالب/رابط معاينة) — لا شيء نعرضه بالوارد فعلاً،
        // لكن سجّل بدل الإسقاط الصامت التام حتى يمكن تتبّع أي فئة أحداث غير مغطّاة لاحقاً.
        logger.debug({ messageKeys: Object.keys(event?.message ?? {}) }, "Messenger event has no displayable content — skipped");
        continue;
      }

      const senderId = event?.sender?.id;
      const pageId = event?.recipient?.id ?? entry.id;
      const providerMessageId = event?.message?.mid;
      const timestamp = Number(event?.timestamp);

      const created = await ingestMetaChannelMessage({
        channelType: "messenger",
        source: "messenger",
        accountConfigKey: "pageId",
        accountConfigValue: String(pageId ?? ""),
        senderId: String(senderId ?? ""),
        providerMessageId: String(providerMessageId ?? ""),
        text,
        attachments,
        timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null,
        providerPayload: event.message,
      });
      if (created) messagesCreated += 1;
    }
  }

  return messagesCreated;
}
