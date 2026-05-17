export type InboxStreamStatus = "live" | "reconnecting" | "closed";

export function openInboxStream(handlers: {
  onMessageReceived?: (payload: unknown) => void;
  onStatus?: (status: InboxStreamStatus) => void;
}): EventSource {
  const base = import.meta.env.BASE_URL || "/";
  const source = new EventSource(`${base}api/inbox/stream`, { withCredentials: true });

  handlers.onStatus?.("reconnecting");
  source.addEventListener("connected", () => handlers.onStatus?.("live"));
  source.addEventListener("heartbeat", () => handlers.onStatus?.("live"));
  source.addEventListener("message.received", (event) => {
    handlers.onStatus?.("live");
    handlers.onMessageReceived?.(JSON.parse((event as MessageEvent).data));
  });
  source.addEventListener("conversation.assigned", () => handlers.onMessageReceived?.(null));
  source.addEventListener("conversation.status_changed", () => handlers.onMessageReceived?.(null));
  source.addEventListener("broadcast.progress", () => handlers.onMessageReceived?.(null));
  source.onerror = () => handlers.onStatus?.("reconnecting");

  return source;
}
