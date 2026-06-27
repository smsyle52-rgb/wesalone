import { describe, it, expect } from "vitest";
import {
  createTemplateSchema,
  templateButtonSchema,
  templateComponentSchema,
} from "../modules/templates/templates.schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bodyComp(text: string, example?: string[][]) {
  return { type: "BODY" as const, text, ...(example ? { example: { body_text: example } } : {}) };
}
function headerComp(format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT", text?: string) {
  return { type: "HEADER" as const, format, ...(text ? { text } : {}) };
}
function footerComp(text: string) {
  return { type: "FOOTER" as const, text };
}
function buttonsComp(buttons: unknown[]) {
  return { type: "BUTTONS" as const, buttons };
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    name: "test_template",
    language: "ar",
    category: "utility" as const,
    components: [bodyComp("مرحباً، طلبك جاهز.")],
    ...overrides,
  };
}

// ─── Button schema validation ─────────────────────────────────────────────────

describe("templateButtonSchema", () => {
  it("accepts a valid QUICK_REPLY button", () => {
    const result = templateButtonSchema.safeParse({ type: "QUICK_REPLY", text: "نعم، شكراً" });
    expect(result.success).toBe(true);
  });

  it("rejects QUICK_REPLY with text over 25 chars", () => {
    const result = templateButtonSchema.safeParse({ type: "QUICK_REPLY", text: "ن".repeat(26) });
    expect(result.success).toBe(false);
  });

  it("accepts a valid PHONE_NUMBER button", () => {
    const result = templateButtonSchema.safeParse({
      type: "PHONE_NUMBER",
      text: "اتصل بنا",
      phone_number: "+966500000000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects PHONE_NUMBER missing phone_number", () => {
    const result = templateButtonSchema.safeParse({ type: "PHONE_NUMBER", text: "اتصل بنا" });
    expect(result.success).toBe(false);
  });

  it("accepts a static URL button (no example)", () => {
    const result = templateButtonSchema.safeParse({
      type: "URL",
      text: "اعرف المزيد",
      url: "https://example.com/page",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a dynamic URL button with example", () => {
    const result = templateButtonSchema.safeParse({
      type: "URL",
      text: "اعرف المزيد",
      url: "https://example.com/{{1}}",
      example: ["order/123"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a dynamic URL button without example (cross-check done in template level)", () => {
    const result = templateButtonSchema.safeParse({
      type: "URL",
      text: "اعرف المزيد",
      url: "https://example.com/{{1}}",
    });
    expect(result.success).toBe(true);
  });

  it("accepts COPY_CODE button", () => {
    const result = templateButtonSchema.safeParse({ type: "COPY_CODE", example: "ABC123" });
    expect(result.success).toBe(true);
  });

  it("rejects COPY_CODE with code over 15 chars", () => {
    const result = templateButtonSchema.safeParse({ type: "COPY_CODE", example: "AVERYLONGOTP123456" });
    expect(result.success).toBe(false);
  });

  it("accepts OTP button (no fields)", () => {
    const result = templateButtonSchema.safeParse({ type: "OTP" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown button type", () => {
    const result = templateButtonSchema.safeParse({ type: "UNKNOWN_TYPE", text: "test" });
    expect(result.success).toBe(false);
  });
});

// ─── Component schema validation ──────────────────────────────────────────────

describe("templateComponentSchema", () => {
  it("accepts HEADER TEXT component", () => {
    const result = templateComponentSchema.safeParse(headerComp("TEXT", "مرحباً"));
    expect(result.success).toBe(true);
  });

  it("accepts HEADER IMAGE component (no text)", () => {
    const result = templateComponentSchema.safeParse(headerComp("IMAGE"));
    expect(result.success).toBe(true);
  });

  it("accepts HEADER VIDEO component", () => {
    const result = templateComponentSchema.safeParse(headerComp("VIDEO"));
    expect(result.success).toBe(true);
  });

  it("accepts HEADER DOCUMENT component", () => {
    const result = templateComponentSchema.safeParse(headerComp("DOCUMENT"));
    expect(result.success).toBe(true);
  });

  it("rejects HEADER with unknown format", () => {
    const result = templateComponentSchema.safeParse({ type: "HEADER", format: "GIF" });
    expect(result.success).toBe(false);
  });

  it("rejects HEADER TEXT with text over 60 chars", () => {
    const result = templateComponentSchema.safeParse(headerComp("TEXT", "ن".repeat(61)));
    expect(result.success).toBe(false);
  });

  it("accepts BODY component", () => {
    const result = templateComponentSchema.safeParse(bodyComp("مرحباً"));
    expect(result.success).toBe(true);
  });

  it("rejects BODY with text over 1024 chars", () => {
    const result = templateComponentSchema.safeParse(bodyComp("ن".repeat(1025)));
    expect(result.success).toBe(false);
  });

  it("accepts FOOTER component", () => {
    const result = templateComponentSchema.safeParse(footerComp("ردّ لا لإلغاء الاشتراك"));
    expect(result.success).toBe(true);
  });

  it("rejects FOOTER with text over 60 chars", () => {
    const result = templateComponentSchema.safeParse(footerComp("ن".repeat(61)));
    expect(result.success).toBe(false);
  });

  it("accepts BUTTONS component with QUICK_REPLY buttons", () => {
    const result = templateComponentSchema.safeParse(
      buttonsComp([{ type: "QUICK_REPLY", text: "نعم" }, { type: "QUICK_REPLY", text: "لا" }]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects BUTTONS component with empty array", () => {
    const result = templateComponentSchema.safeParse(buttonsComp([]));
    expect(result.success).toBe(false);
  });

  it("rejects BUTTONS component with more than 10 buttons", () => {
    const too_many = Array.from({ length: 11 }, (_, i) => ({ type: "QUICK_REPLY", text: `زر ${i + 1}` }));
    const result = templateComponentSchema.safeParse(buttonsComp(too_many));
    expect(result.success).toBe(false);
  });
});

// ─── Template-level validation ────────────────────────────────────────────────

describe("createTemplateSchema — button combination rules", () => {
  it("rejects QUICK_REPLY mixed with URL buttons", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([
            { type: "QUICK_REPLY", text: "نعم" },
            { type: "URL", text: "اعرف المزيد", url: "https://example.com" },
          ]),
        ],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("لا يمكن دمج");
  });

  it("rejects QUICK_REPLY mixed with PHONE_NUMBER buttons", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([
            { type: "QUICK_REPLY", text: "نعم" },
            { type: "PHONE_NUMBER", text: "اتصل", phone_number: "+966500000000" },
          ]),
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects OTP button combined with other buttons", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        category: "authentication",
        components: [
          bodyComp("كودك هو"),
          buttonsComp([{ type: "OTP" }, { type: "COPY_CODE", example: "ABC123" }]),
        ],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("OTP");
  });

  it("rejects more than 2 CTA buttons", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([
            { type: "URL", text: "رابط 1", url: "https://a.com" },
            { type: "URL", text: "رابط 2", url: "https://b.com" },
            { type: "PHONE_NUMBER", text: "هاتف", phone_number: "+966500000000" },
          ]),
        ],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("زرين");
  });

  it("accepts exactly 2 CTA buttons (URL + PHONE)", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([
            { type: "URL", text: "اعرف المزيد", url: "https://example.com" },
            { type: "PHONE_NUMBER", text: "اتصل بنا", phone_number: "+966500000000" },
          ]),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts up to 10 QUICK_REPLY buttons", () => {
    const qrs = Array.from({ length: 10 }, (_, i) => ({ type: "QUICK_REPLY" as const, text: `رد ${i + 1}` }));
    const result = createTemplateSchema.safeParse(
      makeTemplate({ components: [bodyComp("اختر خياراً"), buttonsComp(qrs)] }),
    );
    expect(result.success).toBe(true);
  });
});

// ─── Category-button constraints ──────────────────────────────────────────────

describe("createTemplateSchema — category constraints", () => {
  it("rejects OTP button on non-authentication category", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        category: "marketing",
        components: [bodyComp("كودك"), buttonsComp([{ type: "OTP" }])],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("المصادقة");
  });

  it("rejects COPY_CODE button on utility category", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        category: "utility",
        components: [bodyComp("كودك"), buttonsComp([{ type: "COPY_CODE", example: "ABC123" }])],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts OTP button on authentication category", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        category: "authentication",
        components: [bodyComp("كود التحقق الخاص بك: {{1}}"), buttonsComp([{ type: "OTP" }])],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts COPY_CODE button on authentication category", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        category: "authentication",
        components: [bodyComp("كودك"), buttonsComp([{ type: "COPY_CODE", example: "ABC123" }])],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects URL button on authentication category", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        category: "authentication",
        components: [bodyComp("مرحباً"), buttonsComp([{ type: "URL", text: "رابط", url: "https://example.com" }])],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("المصادقة");
  });
});

// ─── Variable validation ──────────────────────────────────────────────────────

describe("createTemplateSchema — variable contiguity", () => {
  it("accepts contiguous variables {{1}} {{2}}", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [bodyComp("مرحباً {{1}}، طلبك {{2}} جاهز.")],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects non-contiguous variables {{1}} {{3}} (skips {{2}})", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [bodyComp("مرحباً {{1}}، طلبك {{3}} جاهز.")],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("متتالية");
  });

  it("rejects non-contiguous starting at {{2}} instead of {{1}}", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [bodyComp("مرحباً {{2}}")],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts body with no variables", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({ components: [bodyComp("رسالة بدون متغيرات")] }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts body with single variable {{1}}", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({ components: [bodyComp("مرحباً {{1}}")] }),
    );
    expect(result.success).toBe(true);
  });
});

// ─── Template-level component rules ──────────────────────────────────────────

describe("createTemplateSchema — component rules", () => {
  it("rejects template with no BODY component", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [headerComp("TEXT", "رأس فقط"), footerComp("تذييل")],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("BODY");
  });

  it("requires at least one component", () => {
    const result = createTemplateSchema.safeParse(makeTemplate({ components: [] }));
    expect(result.success).toBe(false);
  });

  it("accepts all header formats", () => {
    for (const format of ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const) {
      const result = createTemplateSchema.safeParse(
        makeTemplate({
          components: [
            format === "TEXT" ? headerComp(format, "نص الرأس") : headerComp(format),
            bodyComp("الجسم"),
          ],
        }),
      );
      expect(result.success, `Expected success for HEADER ${format}`).toBe(true);
    }
  });

  it("rejects template with empty name", () => {
    const result = createTemplateSchema.safeParse(makeTemplate({ name: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects template with invalid category", () => {
    const result = createTemplateSchema.safeParse(makeTemplate({ category: "invalid" }));
    expect(result.success).toBe(false);
  });

  it("validates all three categories", () => {
    for (const category of ["marketing", "utility", "authentication"] as const) {
      const result = createTemplateSchema.safeParse(
        makeTemplate({ category, components: [bodyComp("مرحباً")] }),
      );
      expect(result.success, `Expected success for category ${category}`).toBe(true);
    }
  });
});

// ─── Dynamic URL buttons ──────────────────────────────────────────────────────

describe("createTemplateSchema — dynamic URL button validation", () => {
  it("rejects dynamic URL button (contains {{1}}) without example", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([{ type: "URL", text: "تتبع طلبك", url: "https://example.com/orders/{{1}}" }]),
        ],
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.error?.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("ديناميكي");
  });

  it("accepts dynamic URL button with example", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([{
            type: "URL",
            text: "تتبع طلبك",
            url: "https://example.com/orders/{{1}}",
            example: ["ORD-12345"],
          }]),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts static URL button without example", () => {
    const result = createTemplateSchema.safeParse(
      makeTemplate({
        components: [
          bodyComp("مرحباً"),
          buttonsComp([{ type: "URL", text: "موقعنا", url: "https://example.com" }]),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});
