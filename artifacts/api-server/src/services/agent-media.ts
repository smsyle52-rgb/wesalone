import type { messagesTable } from "@workspace/db";
import { ACTIVE_PROVIDER } from "../lib/ai-provider";
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
};

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
    return { context: "", sources: [] };
  }

  const dryRun = isDryRun();
  const lines: string[] = [];
  const sources: string[] = [];

  for (const { message, attachment } of inboundMedia) {
    const label = attachmentLabel(attachment);
    const source = `${label}${attachment.media_id ? ` (${attachment.media_id})` : ""}`;
    sources.push(source);

    if (attachment.type === "image") {
      const caption = attachment.caption || message.content;
      lines.push(
        dryRun
          ? `- ${label}: الوضع التجريبي مفعل، لذلك لم يتم تنزيل الصورة. استخدم النص المرافق والمعرفة المتاحة، وإن لم تكفِ فاطلب توضيحاً قصيراً.`
          : `- ${label}: لدى المحادثة صورة واردة${attachment.url ? ` عبر الرابط ${attachment.url}` : ""}. إن لم تكن تفاصيل الصورة واضحة في السياق، لا تخمّن واطلب توضيحاً قصيراً.`,
      );
      if (caption && !String(caption).startsWith("[image:")) lines.push(`  وصف مرافق: ${caption}`);
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

  logger.debug({ mediaCount: inboundMedia.length, dryRun }, "Agent media context assembled");

  return {
    context: `\n\nسياق الوسائط الواردة:\n${lines.join("\n")}`,
    sources,
  };
}
