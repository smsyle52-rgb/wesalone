import { z } from "zod";

// ─── Per-button type schemas ──────────────────────────────────────────────────

export const quickReplyButtonSchema = z.object({
  type: z.literal("QUICK_REPLY"),
  text: z.string().trim().min(1, "نص الزر مطلوب").max(25, "الحد الأقصى 25 حرف"),
});

export const phoneButtonSchema = z.object({
  type: z.literal("PHONE_NUMBER"),
  text: z.string().trim().min(1, "نص الزر مطلوب").max(25, "الحد الأقصى 25 حرف"),
  phone_number: z.string().trim().min(1, "رقم الهاتف مطلوب").max(20, "رقم الهاتف طويل جداً"),
});

export const urlButtonSchema = z.object({
  type: z.literal("URL"),
  text: z.string().trim().min(1, "نص الزر مطلوب").max(25, "الحد الأقصى 25 حرف"),
  url: z.string().trim().min(1, "الرابط مطلوب").max(2000, "الرابط طويل جداً"),
  // example required when url contains {{1}} (dynamic)
  example: z.array(z.string().trim()).optional(),
});

export const copyCodeButtonSchema = z.object({
  type: z.literal("COPY_CODE"),
  example: z.string().trim().min(1, "الكود مطلوب").max(15, "الحد الأقصى 15 حرف"),
});

export const otpButtonSchema = z.object({
  type: z.literal("OTP"),
});

export const templateButtonSchema = z.discriminatedUnion("type", [
  quickReplyButtonSchema,
  phoneButtonSchema,
  urlButtonSchema,
  copyCodeButtonSchema,
  otpButtonSchema,
]);

// ─── Component schemas ────────────────────────────────────────────────────────

const headerComponentSchema = z.object({
  type: z.literal("HEADER"),
  format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]),
  text: z.string().trim().max(60, "عنوان الرأس لا يتجاوز 60 حرفاً").optional().nullable(),
  example: z.unknown().optional().nullable(),
});

const bodyComponentSchema = z.object({
  type: z.literal("BODY"),
  text: z.string().trim().min(1, "جسم القالب مطلوب").max(1024, "جسم القالب لا يتجاوز 1024 حرفاً"),
  example: z.unknown().optional().nullable(),
});

const footerComponentSchema = z.object({
  type: z.literal("FOOTER"),
  text: z.string().trim().min(1).max(60, "تذييل القالب لا يتجاوز 60 حرفاً"),
});

const buttonsComponentSchema = z.object({
  type: z.literal("BUTTONS"),
  buttons: z.array(templateButtonSchema)
    .min(1, "أضف زر واحد على الأقل")
    .max(10, "الحد الأقصى 10 أزرار"),
});

export const templateComponentSchema = z.union([
  headerComponentSchema,
  bodyComponentSchema,
  footerComponentSchema,
  buttonsComponentSchema,
]);

// ─── Variable metadata ────────────────────────────────────────────────────────

export const templateVariableSchema = z.object({
  key: z.string().trim().min(1).max(80),
  example: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

// ─── Template CRUD schemas ────────────────────────────────────────────────────

export const createTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "اسم القالب مطلوب").max(120),
    language: z.string().trim().min(2).max(16).default("ar"),
    category: z.enum(["marketing", "utility", "authentication"]),
    channelAccountId: z.string().uuid().optional().nullable(),
    components: z.array(templateComponentSchema).min(1, "أضف مكوناً واحداً على الأقل"),
    variables: z.array(templateVariableSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const buttonsComp = data.components.find((c) => c.type === "BUTTONS") as
      | { type: "BUTTONS"; buttons: Array<{ type: string }> }
      | undefined;

    if (buttonsComp) {
      const types = buttonsComp.buttons.map((b) => b.type);
      const hasQuickReply = types.some((t) => t === "QUICK_REPLY");
      const hasOTP = types.some((t) => t === "OTP");
      const hasCopyCode = types.some((t) => t === "COPY_CODE");
      const hasCTA = types.some((t) => t === "PHONE_NUMBER" || t === "URL");

      // Cannot mix quick-reply with CTA
      if (hasQuickReply && hasCTA) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "لا يمكن دمج الردود السريعة مع أزرار الإجراء (هاتف/رابط)",
          path: ["components"],
        });
      }

      // OTP must be alone
      if (hasOTP && buttonsComp.buttons.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "زر OTP يجب أن يكون بمفرده",
          path: ["components"],
        });
      }

      // CTA max 2
      const ctaCount = types.filter((t) => t === "PHONE_NUMBER" || t === "URL").length;
      if (ctaCount > 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "الحد الأقصى زرين من نوع الإجراء (هاتف + رابط)",
          path: ["components"],
        });
      }

      // Authentication-only buttons require authentication category
      if ((hasOTP || hasCopyCode) && data.category !== "authentication") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "أزرار OTP ونسخ الكود متاحة فقط لفئة المصادقة",
          path: ["components"],
        });
      }

      // Authentication category should not use marketing-style CTAs
      if (data.category === "authentication" && hasCTA) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "فئة المصادقة لا تدعم أزرار الهاتف أو الروابط",
          path: ["components"],
        });
      }
    }

    // Validate that dynamic URL buttons have example values
    if (buttonsComp) {
      for (const btn of buttonsComp.buttons) {
        if (btn.type === "URL") {
          const urlBtn = btn as { type: "URL"; url: string; example?: string[] };
          if (urlBtn.url.includes("{{1}}") && (!urlBtn.example || urlBtn.example.length === 0)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "الرابط الديناميكي يتطلب مثالاً لقيمة المتغير",
              path: ["components"],
            });
          }
        }
      }
    }

    // Body must exist
    const hasBody = data.components.some((c) => c.type === "BODY");
    if (!hasBody) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "جسم القالب (BODY) مطلوب",
        path: ["components"],
      });
    }

    // Validate body variable contiguity ({{1}}, {{2}}, not {{1}}, {{3}})
    const bodyComp = data.components.find((c) => c.type === "BODY") as
      | { type: "BODY"; text: string }
      | undefined;
    if (bodyComp) {
      const nums = Array.from(bodyComp.text.matchAll(/\{\{(\d+)\}\}/g))
        .map((m) => parseInt(m[1]))
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .sort((a, b) => a - b);
      if (nums.length > 0 && nums.some((n, i) => n !== i + 1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "المتغيرات يجب أن تكون متتالية: {{1}} ثم {{2}} ثم {{3}}...",
          path: ["components"],
        });
      }
    }
  });

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: z.string().trim().min(2).max(16).optional(),
  category: z.enum(["marketing", "utility", "authentication"]).optional(),
  channelAccountId: z.string().uuid().optional().nullable(),
  components: z.array(templateComponentSchema).optional(),
  variables: z.array(templateVariableSchema).optional(),
});

export const listTemplatesQuerySchema = z.object({
  status: z.string().trim().optional(),
  language: z.string().trim().optional(),
  category: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
});
