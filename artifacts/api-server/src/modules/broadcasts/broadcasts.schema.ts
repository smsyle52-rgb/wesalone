import { z } from "zod";

export const audienceFilterSchema = z.object({
  tags: z.array(z.string().trim()).optional(),
  includeTags: z.array(z.string().trim()).optional(),
  contact_ids: z.array(z.string().uuid()).optional(),
  contactIds: z.array(z.string().uuid()).optional(),
  exclude_ids: z.array(z.string().uuid()).optional(),
  excludeIds: z.array(z.string().uuid()).optional(),
}).passthrough();

export const variableMappingSchema = z.record(z.string(), z.string());

export const createBroadcastSchema = z.object({
  name: z.string().trim().min(1, "اسم الحملة مطلوب").max(160),
  templateId: z.string().uuid(),
  channelAccountId: z.string().uuid(),
  audienceFilter: audienceFilterSchema.default({}),
  variableMapping: variableMappingSchema.default({}),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export const updateBroadcastSchema = createBroadcastSchema.partial();

export const listBroadcastsQuerySchema = z.object({
  status: z.string().trim().optional(),
});
