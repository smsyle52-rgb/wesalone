import type { ChannelAccount } from "@workspace/db";
import { logger } from "../lib/logger";

type MetaResult = {
  ok: boolean;
  dryRun: boolean;
  requestId?: string;
  id?: string;
  status?: string;
  payload?: unknown;
  error?: string;
};

const graphVersion = process.env.META_GRAPH_VERSION ?? "v21.0";

function channelConfig(channelAccount: ChannelAccount | null | undefined): Record<string, unknown> {
  return (channelAccount?.providerConfig && typeof channelAccount.providerConfig === "object"
    ? channelAccount.providerConfig
    : {}) as Record<string, unknown>;
}

function stringConfig(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAccessToken(channelAccount?: ChannelAccount | null): string | null {
  if (process.env.META_DRY_RUN === "true") return null;
  if (process.env.META_SYSTEM_USER_TOKEN) return process.env.META_SYSTEM_USER_TOKEN;
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN;
  if (channelAccount?.credentialsSecretRef) {
    logger.warn({ channelAccountId: channelAccount.id }, "Meta token secret reference is configured but Secret Manager runtime resolver is not enabled");
  }
  return null;
}

function dryRunResult(payload: unknown): MetaResult {
  return {
    ok: true,
    dryRun: true,
    id: `dry_${Date.now().toString(36)}`,
    payload,
  };
}

async function callMeta(path: string, opts: { method?: string; token: string; body?: unknown }): Promise<MetaResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const url = `https://graph.facebook.com/${graphVersion}/${path}`;

  async function attempt() {
    return fetch(url, {
      method: opts.method ?? "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  }

  try {
    let response = await attempt();
    if (response.status >= 500) response = await attempt();
    const requestId = response.headers.get("x-fb-request-id") ?? undefined;
    const payload: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { ok: false, dryRun: false, requestId, status: String(response.status), payload, error: "meta_graph_error" };
    }

    const id = typeof payload?.messages?.[0]?.id === "string"
      ? payload.messages[0].id
      : typeof payload?.id === "string"
        ? payload.id
        : undefined;
    return { ok: true, dryRun: false, requestId, id, payload };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTemplateMessage(
  channelAccount: ChannelAccount | null | undefined,
  to: string,
  templateName: string,
  language: string,
  components: unknown[] = [],
): Promise<MetaResult> {
  const config = channelConfig(channelAccount);
  const phoneNumberId = stringConfig(config, "phoneNumberId") ?? process.env.META_PHONE_NUMBER_ID;
  const token = getAccessToken(channelAccount);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  if (!token || !phoneNumberId) return dryRunResult(body);
  return callMeta(`${phoneNumberId}/messages`, { token, body });
}

export async function sendTextMessage(
  channelAccount: ChannelAccount | null | undefined,
  to: string,
  bodyText: string,
  contextMessageId?: string,
): Promise<MetaResult> {
  const config = channelConfig(channelAccount);
  const phoneNumberId = stringConfig(config, "phoneNumberId") ?? process.env.META_PHONE_NUMBER_ID;
  const token = getAccessToken(channelAccount);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: bodyText },
    ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
  };

  if (!token || !phoneNumberId) return dryRunResult(body);
  return callMeta(`${phoneNumberId}/messages`, { token, body });
}

export async function submitTemplate(channelAccount: ChannelAccount | null | undefined, template: {
  name: string;
  language: string;
  category: string;
  components: unknown;
}): Promise<MetaResult> {
  const config = channelConfig(channelAccount);
  const wabaId = stringConfig(config, "wabaId") ?? process.env.META_WABA_ID;
  const token = getAccessToken(channelAccount);
  const body = {
    name: template.name,
    language: template.language,
    category: template.category.toUpperCase(),
    components: template.components,
  };

  if (!token || !wabaId) return dryRunResult(body);
  return callMeta(`${wabaId}/message_templates`, { token, body });
}

export async function fetchTemplateStatus(channelAccount: ChannelAccount | null | undefined, metaTemplateId: string): Promise<MetaResult> {
  const token = getAccessToken(channelAccount);
  if (!token || !metaTemplateId) return dryRunResult({ metaTemplateId, status: "submitted" });
  return callMeta(`${metaTemplateId}?fields=id,name,status,rejected_reason`, { token, method: "GET" });
}
