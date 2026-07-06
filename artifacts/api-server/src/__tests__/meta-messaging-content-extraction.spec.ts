import { describe, expect, it } from "vitest";
import { extractMetaMessagingContent } from "../modules/integrations/meta-channel-ingest";

// حادثة 6 يوليو 2026: رسائل ماسنجر/إنستغرام بلا نص عادي (صورة/ملصق/فيديو/صوت/ملف بلا كابشن)
// كانت تُسقَط بصمت تامة قبل هذا الإصلاح — العميل يرسل ولا يظهر شيء إطلاقاً بالوارد.

describe("extractMetaMessagingContent — استخراج محتوى ماسنجر/إنستغرام", () => {
  it("نص عادي يمرّ كما هو بلا مرفقات", () => {
    const result = extractMetaMessagingContent({ text: "مرحباً" }, "messenger");
    expect(result).toEqual({ text: "مرحباً", attachments: [] });
  });

  it("صورة بلا نص تُنتج نصاً بديلاً ومرفقاً (لا تُسقَط بصمت)", () => {
    const result = extractMetaMessagingContent(
      { attachments: [{ type: "image", payload: { url: "https://example.com/photo.jpg" } }] },
      "messenger",
    );
    expect(result.text).toBe("[صورة]");
    expect(result.attachments).toEqual([{ type: "image", provider: "messenger", url: "https://example.com/photo.jpg" }]);
  });

  it("ملف Meta الخام type=\"file\" يُوحَّد إلى \"document\" (اتساقاً مع واتساب)", () => {
    const result = extractMetaMessagingContent(
      { attachments: [{ type: "file", payload: { url: "https://example.com/doc.pdf" } }] },
      "instagram",
    );
    expect(result.attachments).toEqual([{ type: "document", provider: "instagram", url: "https://example.com/doc.pdf" }]);
    expect(result.text).toBe("[ملف]");
  });

  it("نص مع مرفق يُبقي النص الحقيقي (لا يستبدله بنص بديل)", () => {
    const result = extractMetaMessagingContent(
      { text: "شوف هذا", attachments: [{ type: "video", payload: { url: "https://example.com/v.mp4" } }] },
      "messenger",
    );
    expect(result.text).toBe("شوف هذا");
    expect(result.attachments).toHaveLength(1);
  });

  it("مرفق غير مدعوم (مثل مشاركة قالب/رابط) بلا نص يُرجع فارغاً — لا شيء نعرضه فعلاً", () => {
    const result = extractMetaMessagingContent(
      { attachments: [{ type: "template", payload: {} }] },
      "messenger",
    );
    expect(result).toEqual({ text: "", attachments: [] });
  });

  it("لا نص ولا مرفقات إطلاقاً يُرجع فارغاً", () => {
    expect(extractMetaMessagingContent({}, "messenger")).toEqual({ text: "", attachments: [] });
    expect(extractMetaMessagingContent(null, "instagram")).toEqual({ text: "", attachments: [] });
  });
});
