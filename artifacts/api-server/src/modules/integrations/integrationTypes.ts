export const integrationProviders = [
  "meta",
  "whatsapp",
  "whatsapp_cloud",
  "instagram",
  "messenger",
  "telegram",
  "website_widget",
  "payment_manual",
  "payment_gateway",
  "storage_gcs",
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export const providerAccountStatuses = ["draft", "active", "disabled", "error"] as const;
export type ProviderAccountStatus = (typeof providerAccountStatuses)[number];

export const webhookEventStatuses = ["received", "processing", "processed", "failed", "ignored", "dead_letter"] as const;
export type WebhookEventStatus = (typeof webhookEventStatuses)[number];

export const outboxStatuses = ["pending", "sending", "sent", "failed", "cancelled"] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const healthStatuses = ["ok", "warning", "error", "unknown"] as const;
export type HealthStatus = (typeof healthStatuses)[number];

export const providerLabels: Record<IntegrationProvider, string> = {
  meta: "Meta",
  whatsapp: "WhatsApp",
  whatsapp_cloud: "WhatsApp Cloud API",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
  website_widget: "Website Widget",
  payment_manual: "Manual Payments",
  payment_gateway: "Payment Gateway",
  storage_gcs: "Google Cloud Storage",
};

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (integrationProviders as readonly string[]).includes(value);
}
