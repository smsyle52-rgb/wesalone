import { handleInstagramWebhook } from "../instagram.handler";
import type { DispatchResult } from "./whatsapp.adapter";

export async function dispatchInstagramWebhook(payload: unknown): Promise<DispatchResult> {
  const messagesCreated = await handleInstagramWebhook(payload);
  return { handled: messagesCreated > 0, messagesCreated, statusesUpdated: 0 };
}
