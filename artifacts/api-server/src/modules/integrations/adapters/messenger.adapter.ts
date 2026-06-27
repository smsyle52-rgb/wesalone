import { handleMessengerWebhook } from "../messenger.handler";
import type { DispatchResult } from "./whatsapp.adapter";

export async function dispatchMessengerWebhook(payload: unknown): Promise<DispatchResult> {
  const messagesCreated = await handleMessengerWebhook(payload);
  return { handled: messagesCreated > 0, messagesCreated, statusesUpdated: 0 };
}
