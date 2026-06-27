import { handleMetaWhatsAppWebhook, type MetaWebhookResult } from "../meta-webhook.handler";

export type DispatchResult = MetaWebhookResult;

export async function dispatchWhatsAppWebhook(payload: unknown): Promise<DispatchResult> {
  return handleMetaWhatsAppWebhook(payload);
}
