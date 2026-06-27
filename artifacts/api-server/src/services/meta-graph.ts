import type { ChannelAccount } from "@workspace/db";
import { AppError } from "../lib/errors";
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

function requireMetaGraphVersion(): string {
  const version = process.env.META_GRAPH_VERSION?.trim();
  if (!version) throw new Error("META_GRAPH_VERSION is not configured");
  return version;
}

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
  const url = `https://graph.facebook.com/${requireMetaGraphVersion()}/${path}`;

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

// ─── Arabic error mapping ─────────────────────────────────────────────────────

export function parseMetaErrorAr(payload: unknown): string {
  const errObj = (payload as Record<string, unknown> | null | undefined)?.error as Record<string, unknown> | undefined;
  const code = typeof errObj?.code === "number" ? errObj.code : 0;
  const message = typeof errObj?.message === "string" ? errObj.message : "";
  const details = ((errObj?.error_data as Record<string, unknown> | undefined)?.details as string | undefined) ?? "";

  if (code === 190) return "انتهت صلاحية رمز الوصول أو أنه غير صالح. يرجى إعادة الاتصال بميتا.";
  if (code === 10 || (code >= 200 && code < 300)) return "التطبيق لا يملك صلاحية هذه العملية. راجع أذونات تطبيق ميتا.";
  if (code === 0 || code === 3) return "العملية غير مسموح بها في هذا السياق.";
  if (code === 4 || code === 80007 || code === 130429) return "تم تجاوز حد معدّل الطلبات. انتظر دقيقة ثم أعد المحاولة.";
  if (code === 132000) return "قالب بهذا الاسم موجود مسبقاً لدى ميتا. غيّر اسم القالب أو احذف النسخة القديمة.";
  if (code === 132001) return "القالب محذوف مسبقاً من ميتا.";
  if (code === 132005) return "رمز اللغة غير صالح. استخدم الرموز الرسمية (ar، en، en_US...).";
  if (code === 132007) return "محتوى القالب يخالف سياسة ميتا للمحتوى.";
  if (code === 132012) return "عدد أمثلة المتغيرات لا يتطابق مع متغيرات النص.";
  if (code === 132016) return "مكوّنات القالب غير صالحة أو مكررة.";
  if (code === 132068) return "صيغة المتغيرات غير صحيحة. تأكد من استخدام {{1}} {{2}} بشكل متتالٍ.";
  const detail = details || message;
  return detail ? `خطأ من ميتا (${code}): ${detail}` : `خطأ غير متوقع من ميتا (${code}).`;
}

export function assertMetaOk(result: MetaResult, context?: string): void {
  if (!result.ok) {
    const msg = parseMetaErrorAr(result.payload);
    logger.warn({ code: result.status, ctx: context, requestId: result.requestId, payload: result.payload }, "Meta API error");
    throw new AppError(400, msg, "META_API_ERROR");
  }
}

// ─── Messaging ────────────────────────────────────────────────────────────────

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

// ─── Template management ──────────────────────────────────────────────────────

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

export async function editMetaTemplate(
  channelAccount: ChannelAccount | null | undefined,
  metaTemplateId: string,
  components: unknown,
): Promise<MetaResult> {
  const token = getAccessToken(channelAccount);
  if (!token) return dryRunResult({ metaTemplateId, components });
  return callMeta(metaTemplateId, { token, body: { components } });
}

export async function deleteMetaTemplate(
  channelAccount: ChannelAccount | null | undefined,
  name: string,
  metaTemplateId: string,
): Promise<MetaResult> {
  const config = channelConfig(channelAccount);
  const wabaId = stringConfig(config, "wabaId") ?? process.env.META_WABA_ID;
  const token = getAccessToken(channelAccount);
  if (!token || !wabaId) return dryRunResult({ name, metaTemplateId });
  const path = `${wabaId}/message_templates?name=${encodeURIComponent(name)}&hsm_id=${encodeURIComponent(metaTemplateId)}`;
  return callMeta(path, { token, method: "DELETE" });
}

export async function fetchTemplateStatus(channelAccount: ChannelAccount | null | undefined, metaTemplateId: string): Promise<MetaResult> {
  const token = getAccessToken(channelAccount);
  if (!token || !metaTemplateId) return dryRunResult({ metaTemplateId, status: "submitted" });
  return callMeta(`${metaTemplateId}?fields=id,name,status,rejected_reason`, { token, method: "GET" });
}

export async function listAllMetaTemplates(
  channelAccount: ChannelAccount | null | undefined,
): Promise<MetaResult> {
  const config = channelConfig(channelAccount);
  const wabaId = stringConfig(config, "wabaId") ?? process.env.META_WABA_ID;
  const token = getAccessToken(channelAccount);
  if (!token || !wabaId) return dryRunResult({ data: [], paging: {} });
  const path = `${wabaId}/message_templates?fields=id,name,status,language,category,rejected_reason&limit=100`;
  return callMeta(path, { token, method: "GET" });
}

// ─── Media upload (for IMAGE / VIDEO / DOCUMENT header examples) ──────────────
// Step 1: create upload session → Step 2: POST raw bytes → get header_handle

export async function uploadHeaderMedia(
  channelAccount: ChannelAccount | null | undefined,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<MetaResult> {
  const config = channelConfig(channelAccount);
  const wabaId = stringConfig(config, "wabaId") ?? process.env.META_WABA_ID;
  const token = getAccessToken(channelAccount);

  if (!token || !wabaId) {
    return dryRunResult({ header_handle: `dry_handle_${Date.now().toString(36)}` });
  }

  const version = requireMetaGraphVersion();
  const base = `https://graph.facebook.com/${version}`;

  // Step 1: create upload session
  const sessionRes = await fetch(
    `${base}/${wabaId}/uploads?file_length=${fileBuffer.length}&file_type=${encodeURIComponent(mimeType)}&file_name=${encodeURIComponent(fileName)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    },
  );

  if (!sessionRes.ok) {
    const errPayload = await sessionRes.json().catch(() => ({}));
    logger.warn({ status: sessionRes.status, payload: errPayload }, "Meta upload session creation failed");
    return { ok: false, dryRun: false, status: String(sessionRes.status), payload: errPayload, error: "upload_session_error" };
  }

  const sessionData = (await sessionRes.json()) as Record<string, unknown>;
  const uploadSessionId = sessionData.id as string | undefined;

  if (!uploadSessionId) {
    logger.warn({ sessionData }, "Meta upload session returned no id");
    return { ok: false, dryRun: false, status: "0", payload: sessionData, error: "no_upload_session_id" };
  }

  // Step 2: upload raw bytes
  const uploadRes = await fetch(`${base}/${uploadSessionId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      "Content-Type": mimeType,
      file_offset: "0",
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errPayload = await uploadRes.json().catch(() => ({}));
    logger.warn({ status: uploadRes.status, payload: errPayload }, "Meta file upload failed");
    return { ok: false, dryRun: false, status: String(uploadRes.status), payload: errPayload, error: "upload_bytes_error" };
  }

  const uploadData = (await uploadRes.json()) as Record<string, unknown>;
  const headerHandle = uploadData.h as string | undefined;

  if (!headerHandle) {
    logger.warn({ uploadData }, "Meta upload returned no handle");
    return { ok: false, dryRun: false, status: "0", payload: uploadData, error: "no_header_handle" };
  }

  return { ok: true, dryRun: false, id: headerHandle, payload: { header_handle: headerHandle } };
}
