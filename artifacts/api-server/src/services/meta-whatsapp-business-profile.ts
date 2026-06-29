import { createDecipheriv, createHash } from "node:crypto";
import type { ChannelAccount } from "@workspace/db";
import { AppError } from "../lib/errors";
import {
  BUSINESS_PROFILE_IMAGE_MAX_BYTES,
  BUSINESS_PROFILE_IMAGE_MIME_TYPES,
  type BusinessProfileUpdateInput,
} from "../modules/whatsapp-management/whatsapp-business-profile.schema";

export type SafeBusinessProfile = {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
};

export type SafeMetaError = {
  httpStatus?: number;
  code?: number;
  errorSubcode?: number;
  type?: string;
  message?: string;
  fbtraceId?: string;
  requestId?: string;
};

export type BusinessProfileSnapshot = {
  profile?: SafeBusinessProfile;
  syncedAt?: string;
  lastError?: {
    code: string;
    message: string;
    at: string;
    metaCode?: number;
  } | null;
};

export type TrustedWhatsAppAccount = ChannelAccount & {
  providerConfig: Record<string, unknown>;
  trustedWabaId: string;
  trustedPhoneNumberId: string;
  trustedMetaAppId: string | null;
};

export class WhatsAppBusinessProfileError extends AppError {
  constructor(
    statusCode: number,
    messageAr: string,
    code: string,
    public safeMeta?: SafeMetaError,
    public lastSyncedProfile?: SafeBusinessProfile,
    public lastSyncedAt?: string,
  ) {
    super(statusCode, messageAr, code);
    this.name = "WhatsAppBusinessProfileError";
  }
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFrom(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function assertTrustedWhatsAppAccount(
  account: ChannelAccount | null | undefined,
  workspaceId: string,
): TrustedWhatsAppAccount {
  if (!account || account.workspaceId !== workspaceId) {
    throw new WhatsAppBusinessProfileError(404, "حساب واتساب غير موجود في مساحة العمل الحالية", "WHATSAPP_ACCOUNT_NOT_FOUND");
  }

  const providerConfig = recordFrom(account.providerConfig);
  const provider = stringFrom(providerConfig, "provider")?.toLowerCase();
  if (account.channelType !== "whatsapp" || provider !== "meta") {
    throw new WhatsAppBusinessProfileError(
      422,
      "الحساب المحدد ليس حساب واتساب مرتبطًا رسميًا عبر Meta",
      "INVALID_WHATSAPP_META_ACCOUNT",
    );
  }

  const trustedWabaId = stringFrom(providerConfig, "waba_id", "wabaId");
  const trustedPhoneNumberId = stringFrom(providerConfig, "phone_number_id", "phoneNumberId");
  if (!trustedWabaId || !trustedPhoneNumberId) {
    throw new WhatsAppBusinessProfileError(
      409,
      "بيانات WABA أو رقم الهاتف الموثوقة غير مكتملة في حساب القناة",
      "WHATSAPP_ACCOUNT_IDENTIFIERS_MISSING",
    );
  }

  return {
    ...account,
    providerConfig,
    trustedWabaId,
    trustedPhoneNumberId,
    trustedMetaAppId: stringFrom(providerConfig, "meta_app_id", "metaAppId"),
  } as TrustedWhatsAppAccount;
}

function credentialsKey(secretMaterial: string): Buffer {
  return createHash("sha256").update(secretMaterial).digest();
}

export function resolveCredentialsSecretRef(
  secretRef: string | null | undefined,
  secretMaterial = process.env.META_OAUTH_STATE_SECRET ?? process.env.SESSION_SECRET,
): string {
  if (!secretRef) {
    throw new WhatsAppBusinessProfileError(
      409,
      "لا يوجد رمز وصول محفوظ لهذا الحساب. أعد ربط الحساب من إعدادات Meta.",
      "META_CREDENTIAL_REFERENCE_MISSING",
    );
  }

  if (!secretRef.startsWith("enc:v1:")) {
    throw new WhatsAppBusinessProfileError(
      409,
      "مرجع رمز الوصول لهذا الحساب غير مدعوم أو غير قابل للحل بأمان.",
      "META_CREDENTIAL_REFERENCE_UNSUPPORTED",
    );
  }

  if (!secretMaterial) {
    throw new WhatsAppBusinessProfileError(
      500,
      "تعذر فتح رمز الوصول المحفوظ بسبب نقص إعدادات التشفير في الخادم.",
      "META_CREDENTIAL_DECRYPTION_UNAVAILABLE",
    );
  }

  const parts = secretRef.split(":");
  if (parts.length !== 5) {
    throw new WhatsAppBusinessProfileError(
      409,
      "مرجع رمز الوصول محفوظ بصيغة تالفة.",
      "META_CREDENTIAL_REFERENCE_CORRUPT",
    );
  }

  try {
    const iv = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    const encrypted = Buffer.from(parts[4]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error("invalid encrypted token parts");

    const decipher = createDecipheriv("aes-256-gcm", credentialsKey(secretMaterial), iv);
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8").trim();
    if (!token) throw new Error("empty decrypted token");
    return token;
  } catch {
    throw new WhatsAppBusinessProfileError(
      409,
      "تعذر فتح رمز الوصول المحفوظ لهذا الحساب. المرجع تالف أو مفتاح التشفير غير مطابق.",
      "META_CREDENTIAL_REFERENCE_CORRUPT",
    );
  }
}

export function sanitizeMetaPayload(payload: unknown): unknown {
  const blocked = /(access[_-]?token|authorization|secret|credentials|client[_-]?secret)/i;
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 5) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => visit(item, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !blocked.test(key))
          .slice(0, 40)
          .map(([key, item]) => [key, visit(item, depth + 1)]),
      );
    }
    if (typeof value === "string") return value.slice(0, 500);
    return value;
  };
  return visit(payload, 0);
}

function safeMetaError(payload: unknown, httpStatus?: number, requestId?: string): SafeMetaError {
  const sanitized = recordFrom(sanitizeMetaPayload(payload));
  const error = recordFrom(sanitized.error);
  return {
    httpStatus,
    code: typeof error.code === "number" ? error.code : undefined,
    errorSubcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
    type: typeof error.type === "string" ? error.type.slice(0, 120) : undefined,
    message: typeof error.message === "string" ? error.message.slice(0, 300) : undefined,
    fbtraceId: typeof error.fbtrace_id === "string" ? error.fbtrace_id.slice(0, 120) : undefined,
    requestId,
  };
}

function metaErrorMessageAr(meta: SafeMetaError): string {
  const code = meta.code ?? 0;
  if (code === 190) return "انتهت صلاحية رمز الوصول الخاص بهذا الحساب أو أصبح غير صالح.";
  if (code === 10 || (code >= 200 && code < 300)) return "تطبيق Meta لا يملك الصلاحية المطلوبة لإدارة الملف التجاري.";
  if (code === 4 || code === 80007 || code === 130429) return "تم تجاوز حد طلبات Meta. حاول مرة أخرى بعد قليل.";
  if (code === 100) return "رفضت Meta أحد حقول الملف التجاري. راجع القيم المدخلة وحاول مرة أخرى.";
  if (meta.httpStatus === 401 || meta.httpStatus === 403) return "رفضت Meta الوصول إلى الملف التجاري لهذا الحساب.";
  if (meta.httpStatus === 429) return "تم تجاوز حد طلبات Meta. حاول مرة أخرى بعد قليل.";
  return "تعذر إكمال العملية لدى Meta. لم يتم تسجيل نجاح محلي.";
}

function graphVersion(): string {
  const value = process.env.META_GRAPH_VERSION?.trim();
  if (!value) {
    throw new WhatsAppBusinessProfileError(
      500,
      "إصدار Meta Graph API غير مهيأ في الخادم.",
      "META_GRAPH_VERSION_MISSING",
    );
  }
  return value.startsWith("v") ? value : `v${value}`;
}

type MetaRequestOptions = {
  method?: "GET" | "POST";
  jsonBody?: Record<string, unknown>;
  binaryBody?: Buffer;
  authScheme?: "Bearer" | "OAuth";
  extraHeaders?: Record<string, string>;
};

async function metaRequest(
  path: string,
  token: string,
  options: MetaRequestOptions = {},
): Promise<{ payload: unknown; requestId?: string; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `${options.authScheme ?? "Bearer"} ${token}`,
        ...(options.jsonBody ? { "Content-Type": "application/json" } : {}),
        ...(options.extraHeaders ?? {}),
      },
      body: options.jsonBody
        ? JSON.stringify(options.jsonBody)
        : options.binaryBody,
      signal: controller.signal,
    });
    const requestId = response.headers.get("x-fb-request-id") ?? undefined;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const meta = safeMetaError(payload, response.status, requestId);
      throw new WhatsAppBusinessProfileError(
        response.status === 429 ? 429 : 502,
        metaErrorMessageAr(meta),
        "META_BUSINESS_PROFILE_ERROR",
        meta,
      );
    }
    return { payload, requestId, status: response.status };
  } catch (error) {
    if (error instanceof WhatsAppBusinessProfileError) throw error;
    if ((error as Error)?.name === "AbortError") {
      throw new WhatsAppBusinessProfileError(
        504,
        "انتهت مهلة الاتصال مع Meta. لم يتم حفظ أي نجاح وهمي.",
        "META_TIMEOUT",
      );
    }
    throw new WhatsAppBusinessProfileError(
      502,
      "تعذر الاتصال بخدمة Meta الآن. لم يتم حفظ أي نجاح وهمي.",
      "META_CONNECTION_FAILED",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function sanitizeBusinessProfile(payload: unknown): SafeBusinessProfile {
  const record = recordFrom(payload);
  const profile: SafeBusinessProfile = {};
  const limits: Record<Exclude<keyof SafeBusinessProfile, "websites">, number> = {
    about: 139,
    address: 256,
    description: 512,
    email: 128,
    profile_picture_url: 2048,
    vertical: 100,
  };
  for (const field of ["about", "address", "description", "email", "profile_picture_url", "vertical"] as const) {
    const value = record[field];
    if (typeof value === "string") profile[field] = value.slice(0, limits[field]);
  }
  if (Array.isArray(record.websites)) {
    profile.websites = record.websites.filter((item): item is string => typeof item === "string").slice(0, 2).map((item) => item.slice(0, 256));
  }
  return profile;
}

export async function fetchBusinessProfileFromMeta(token: string, phoneNumberId: string): Promise<SafeBusinessProfile> {
  const fields = "about,address,description,email,profile_picture_url,websites,vertical";
  const result = await metaRequest(
    `${encodeURIComponent(phoneNumberId)}/whatsapp_business_profile?fields=${encodeURIComponent(fields)}`,
    token,
  );
  const root = recordFrom(result.payload);
  const data = Array.isArray(root.data) ? root.data : [];
  if (!data[0] || typeof data[0] !== "object") {
    throw new WhatsAppBusinessProfileError(
      502,
      "أعادت Meta استجابة غير مكتملة للملف التجاري.",
      "META_BUSINESS_PROFILE_INVALID_RESPONSE",
    );
  }
  return sanitizeBusinessProfile(data[0]);
}

export async function updateBusinessProfileAtMeta(
  token: string,
  phoneNumberId: string,
  input: BusinessProfileUpdateInput | { profile_picture_handle: string },
): Promise<void> {
  const result = await metaRequest(`${encodeURIComponent(phoneNumberId)}/whatsapp_business_profile`, token, {
    method: "POST",
    jsonBody: { messaging_product: "whatsapp", ...input },
  });
  const payload = recordFrom(result.payload);
  if (payload.success !== true) {
    throw new WhatsAppBusinessProfileError(
      502,
      "لم تؤكد Meta نجاح تحديث الملف التجاري، لذلك لم يتم تسجيل نجاح.",
      "META_BUSINESS_PROFILE_UNCONFIRMED",
      safeMetaError(result.payload, result.status, result.requestId),
    );
  }
}

export function validateProfileImage(buffer: Buffer, mimeType: string): void {
  if (!BUSINESS_PROFILE_IMAGE_MIME_TYPES.includes(mimeType as (typeof BUSINESS_PROFILE_IMAGE_MIME_TYPES)[number])) {
    throw new WhatsAppBusinessProfileError(415, "نوع الصورة غير مدعوم. استخدم JPEG أو PNG.", "PROFILE_IMAGE_MIME_NOT_ALLOWED");
  }
  if (!buffer.length) {
    throw new WhatsAppBusinessProfileError(400, "ملف الصورة فارغ.", "PROFILE_IMAGE_EMPTY");
  }
  if (buffer.length > BUSINESS_PROFILE_IMAGE_MAX_BYTES) {
    throw new WhatsAppBusinessProfileError(413, "حجم الصورة يتجاوز الحد المسموح وهو 5 ميجابايت.", "PROFILE_IMAGE_TOO_LARGE");
  }
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng = buffer.length >= pngSignature.length && pngSignature.every((byte, index) => buffer[index] === byte);
  if ((mimeType === "image/jpeg" && !isJpeg) || (mimeType === "image/png" && !isPng)) {
    throw new WhatsAppBusinessProfileError(400, "محتوى الملف لا يطابق نوع الصورة المعلن.", "PROFILE_IMAGE_CONTENT_INVALID");
  }
}

export async function uploadBusinessProfileImageToMeta(params: {
  token: string;
  metaAppId: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  validateProfileImage(params.buffer, params.mimeType);
  const query = new URLSearchParams({
    file_length: String(params.buffer.length),
    file_type: params.mimeType,
    file_name: params.fileName,
  });
  const session = await metaRequest(`${encodeURIComponent(params.metaAppId)}/uploads?${query.toString()}`, params.token, {
    method: "POST",
  });
  const sessionPayload = recordFrom(session.payload);
  const uploadId = stringFrom(sessionPayload, "id", "upload_session_id");
  if (!uploadId) {
    throw new WhatsAppBusinessProfileError(502, "لم تُرجع Meta معرّف جلسة رفع الصورة.", "META_UPLOAD_SESSION_MISSING");
  }

  const uploaded = await metaRequest(uploadId, params.token, {
    method: "POST",
    binaryBody: params.buffer,
    authScheme: "OAuth",
    extraHeaders: {
      "Content-Type": params.mimeType,
      file_offset: "0",
    },
  });
  const uploadPayload = recordFrom(uploaded.payload);
  let handle = stringFrom(uploadPayload, "h", "handle");
  if (!handle) {
    const handleResult = await metaRequest(uploadId, params.token);
    handle = stringFrom(recordFrom(handleResult.payload), "h", "handle");
  }
  if (!handle) {
    throw new WhatsAppBusinessProfileError(502, "لم تُرجع Meta معرّف الصورة المرفوعة.", "META_UPLOAD_HANDLE_MISSING");
  }
  return handle;
}

export function readBusinessProfileSnapshot(providerConfig: unknown): BusinessProfileSnapshot {
  const root = recordFrom(providerConfig);
  const management = recordFrom(root.whatsappManagement);
  const profile = recordFrom(management.businessProfile);
  const storedProfile = Object.keys(recordFrom(profile.profile)).length
    ? sanitizeBusinessProfile(profile.profile)
    : undefined;
  return {
    profile: storedProfile,
    syncedAt: typeof profile.syncedAt === "string" ? profile.syncedAt : undefined,
    lastError: profile.lastError && typeof profile.lastError === "object"
      ? (sanitizeMetaPayload(profile.lastError) as BusinessProfileSnapshot["lastError"])
      : null,
  };
}

export function mergeBusinessProfileSnapshot(
  providerConfig: unknown,
  update: { profile?: SafeBusinessProfile; syncedAt?: string; lastError?: BusinessProfileSnapshot["lastError"] },
): Record<string, unknown> {
  const root = recordFrom(providerConfig);
  const management = recordFrom(root.whatsappManagement);
  const current = recordFrom(management.businessProfile);
  return {
    ...root,
    whatsappManagement: {
      ...management,
      businessProfile: {
        ...current,
        ...(update.profile !== undefined ? { profile: sanitizeBusinessProfile(update.profile) } : {}),
        ...(update.syncedAt !== undefined ? { syncedAt: update.syncedAt } : {}),
        ...(update.lastError !== undefined ? { lastError: update.lastError } : {}),
      },
    },
  };
}

export function safeBusinessProfileFailure(error: unknown, at = new Date().toISOString()): NonNullable<BusinessProfileSnapshot["lastError"]> {
  if (error instanceof WhatsAppBusinessProfileError) {
    return {
      code: error.code ?? "WHATSAPP_BUSINESS_PROFILE_ERROR",
      message: error.messageAr,
      at,
      metaCode: error.safeMeta?.code,
    };
  }
  if (error instanceof AppError) {
    return { code: error.code ?? "APP_ERROR", message: error.messageAr, at };
  }
  return { code: "UNEXPECTED_ERROR", message: "حدث خطأ غير متوقع أثناء مزامنة الملف التجاري", at };
}

export function attachLastSnapshot(error: unknown, snapshot: BusinessProfileSnapshot): WhatsAppBusinessProfileError {
  const normalized = error instanceof WhatsAppBusinessProfileError
    ? error
    : error instanceof AppError
      ? new WhatsAppBusinessProfileError(error.statusCode, error.messageAr, error.code ?? "BUSINESS_PROFILE_ERROR")
      : new WhatsAppBusinessProfileError(500, "حدث خطأ غير متوقع أثناء إدارة الملف التجاري", "BUSINESS_PROFILE_ERROR");
  normalized.lastSyncedProfile = snapshot.profile;
  normalized.lastSyncedAt = snapshot.syncedAt;
  return normalized;
}

export function buildBusinessProfileAuditData(params: {
  correlationId: string;
  operation: "sync" | "update" | "photo_update";
  status: "success" | "failed";
  changedFields?: string[];
  error?: unknown;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {
    correlationId: params.correlationId,
    operation: params.operation,
    status: params.status,
  };
  if (params.changedFields) result.changedFields = params.changedFields;
  if (params.error) {
    const safe = safeBusinessProfileFailure(params.error);
    result.error = { code: safe.code, metaCode: safe.metaCode };
  }
  return sanitizeMetaPayload(result) as Record<string, unknown>;
}
