import { ingestMetaChannelMessage } from "./meta-channel-ingest";

export async function handleInstagramWebhook(payload: unknown): Promise<number> {
  const body = payload as any;
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  let messagesCreated = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "messages") continue;
      const value = change?.value ?? {};
      const message = value.message ?? value.messages?.[0] ?? value;
      const text = message?.text ?? value.text;
      if (typeof text !== "string" || !text.trim()) continue;

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
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        providerPayload: message,
      });
      if (created) messagesCreated += 1;
    }
  }

  return messagesCreated;
}
