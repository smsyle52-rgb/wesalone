import { z } from "zod";

export const templateComponentSchema = z.object({
  type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
  format: z.string().trim().max(60).optional().nullable(),
  text: z.string().trim().max(5000).optional().nullable(),
  example: z.unknown().optional(),
  buttons: z.array(z.record(z.unknown())).optional(),
});

export const templateVariableSchema = z.object({
  key: z.string().trim().min(1).max(80),
  example: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "اسم القالب مطلوب").max(120),
  language: z.string().trim().min(2).max(16).default("ar"),
  category: z.enum(["marketing", "utility", "authentication"]),
  channelAccountId: z.string().uuid().optional().nullable(),
  components: z.array(templateComponentSchema).min(1, "أضف مكوناً واحداً على الأقل"),
  variables: z.array(templateVariableSchema).optional().default([]),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const listTemplatesQuerySchema = z.object({
  status: z.string().trim().optional(),
  language: z.string().trim().optional(),
  category: z.string().trim().optional(),
});
