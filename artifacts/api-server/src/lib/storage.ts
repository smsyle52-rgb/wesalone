import { randomUUID } from "node:crypto";
import { logger } from "./logger";

// اسم باكت GCS لرفع الوسائط — يُحقن من البيئة (Cloud Run). فارغ = الرفع معطّل بأمان.
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET ?? "";

// قائمة بيضاء صارمة لأنواع الصور المسموحة → الامتداد على القرص
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isUploadsConfigured(): boolean {
  return UPLOADS_BUCKET.length > 0;
}

// نفس نمط ai-provider.ts: توكن وصول من خادم الميتاداتا (بلا SDK، يُحزَم نظيفاً مع esbuild)
async function getMetadataAccessToken(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" }, signal: controller.signal },
    );
    if (!res.ok) throw new Error(`metadata token request failed with status ${res.status}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("metadata server did not return access_token");
    return data.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * يرفع buffer صورة إلى GCS عبر JSON REST API ويعيد الرابط العام.
 * الباكت يجب أن يكون public-read (صور المنتجات تُعرض للعملاء وقد تُرسَل عبر واتساب).
 * @param prefix مسار منطقي داخل الباكت لعزل المستأجر، مثل products/{workspaceId}
 */
export async function uploadImageBuffer(
  prefix: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (!isUploadsConfigured()) {
    throw new Error("UPLOADS_BUCKET is not configured");
  }
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) {
    throw new Error(`unsupported content type: ${contentType}`);
  }

  const objectName = `${prefix}/${randomUUID()}.${ext}`;
  const token = await getMetadataAccessToken();

  const uploadUrl =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(UPLOADS_BUCKET)}/o` +
    `?uploadType=media&name=${encodeURIComponent(objectName)}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 300) }, "GCS upload failed");
    throw new Error(`GCS upload failed with status ${res.status}`);
  }

  return `https://storage.googleapis.com/${UPLOADS_BUCKET}/${objectName}`;
}
