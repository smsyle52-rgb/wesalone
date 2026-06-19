import type { messagesTable } from "@workspace/db";
import { ACTIVE_PROVIDER, type AiImage } from "../lib/ai-provider";
import { fetchMetaMediaBase64 } from "./meta-media";
import { logger } from "../lib/logger";

type MessageRow = typeof messagesTable.$inferSelect;

type MediaAttachment = {
  type?: string;
  provider?: string;
  media_id?: string;
  url?: string;
  mime_type?: string | null;
  caption?: string | null;
  [key: string]: unknown;
};

type MediaContext = {
  context: string;
  sources: string[];
  // vision: صور واردة كـbase64 لتمريرها للنموذج متعدد الوسائط (Gemini/Vertex).
  images: AiImage[];
};

// vision: حدّ أقصى لعدد الصور المُمرَّرة للنموذج في الرد الواحد (تكلفة + زمن).
const MAX_VISION_IMAGES = 2;

function asAttachments(value: unknown): MediaAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MediaAttachment => !!item && typeof item === "object");
}

function isDryRun(): boolean {
  return ACTIVE_PROVIDER === "mock" || !process.env.META_APP_SECRET;
}

function attachmentLabel(attachment: MediaAttachment): string {
  const type = attachment.type ?? "media";
  if (type === "image") return "صورة مستلمة";
  if (type === "audio" || type === "voice") return "رسالة صوتية مستلمة";
  if (type === "document") return "مستند مستلم";
  if (type === "video") return "فيديو مستلم";
  return "وسائط مستلمة";
}

function isPlaceholderContent(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

export async function loadMediaContext(messages: MessageRow[]): Promise<MediaContext> {
  const inboundMedia = messages
    .filter((message) => message.direction === "inbound")
    .flatMap((message) =>
      asAttachments(message.attachments).map((attachment) => ({
        message,
        attachment,
      })),
    )
    .filter(({ attachment }) => ["image", "audio", "voice", "document", "video"].includes(String(attachment.type ?? "")))
    .slice(-4);

  if (inboundMedia.length === 0) {
    return { context: "", sources: [], images: [] };
  }

  const dryRun = isDryRun();

  // vision: اجلب آخر صورتين واردتين كـbase64 ليحلّلها النموذج بصرياً. عند الفشل تبقى القائمة
  // فارغة وتُستخدم شبكة الأمان النصّية أدناه — فلا تتعطّل حلقة الوكيل.
  const images: AiImage[] = [];
  if (!dryRun) {
    const imageAttachments = inboundMedia
      .filter(({ attachment }) => attachment.type === "image" && typeof attachment.media_id === "string")
      .slice(-MAX_VISION_IMAGES);
    for (const { attachment } of imageAttachments) {
      const fetched = await fetchMetaMediaBase64(String(attachment.media_id));
      if (fetched && fetched.mimeType.startsWith("image/")) images.push(fetched);
    }
  }
  const hasVision = images.length > 0;

  const lines: string[] = [];
  const sources: string[] = [];

  for (const { message, attachment } of inboundMedia) {
    const label = attachmentLabel(attachment);
    const source = `${label}${attachment.media_id ? ` (${attachment.media_id})` : ""}`;
    sources.push(source);

    if (attachment.type === "image") {
      const caption = attachment.caption || message.content;
      lines.push(
        hasVision
          ? `- ${label}: الصورة مرفقة بهذه المحادثة ومتاحة لك بصرياً — حلّل محتواها ورُدّ بناءً عليه مباشرةً. إن كانت غير واضحة فعلاً، اطلب توضيحاً قصيراً.`
          : dryRun
            ? `- ${label}: الوضع التجريبي مفعل، لذلك لم يتم تنزيل الصورة. استخدم النص المرافق والمعرفة المتاحة، وإن لم تكفِ فاطلب توضيحاً قصيراً.`
            : `- ${label}: وصلت صورة لكن تعذّر تحليلها بصرياً الآن. لا تخمّن محتواها واطلب توضيحاً قصيراً.`,
      );
      if (caption && !isPlaceholderContent(String(caption))) lines.push(`  وصف مرافق: ${caption}`);
      continue;
    }

    if (attachment.type === "audio" || attachment.type === "voice") {
      lines.push(
        dryRun
          ? `- ${label}: الوضع التجريبي مفعل، لذلك لم يتم تفريغ الصوت. إذا لم يوجد نص كافٍ، اطلب من العميل كتابة المطلوب أو انتظر تدخل الفريق.`
          : `- ${label}: توجد ملاحظة صوتية واردة. إذا فشل التفريغ أو لم يظهر نص واضح، لا تعطّل المحادثة؛ اكتب رداً لطيفاً يقول إن الرسالة وصلت وسيتم التأكد منها.`,
      );
      continue;
    }

    lines.push(`- ${label}: تم حفظ مرجع الوسائط مع الرسالة. لا تفترض تفاصيل غير ظاهرة في المعرفة أو النص.`);
  }

  logger.debug({ mediaCount: inboundMedia.length, imageCount: images.length, dryRun }, "Agent media context assembled");

  return {
    context: `\n\nسياق الوسائط الواردة:\n${lines.join("\n")}`,
    sources,
    images,
  };
}
