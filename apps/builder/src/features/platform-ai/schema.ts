import { vertexModels } from "@chatbotx.io/ai/models"
import { z } from "zod"

export const updatePlatformAiSettingsSchema = z.object({
  chatModel: vertexModels,
  // Empty string / undefined both mean "no fallback configured" — the
  // SelectField's clear button sets `undefined`, the form default is "".
  fallbackModel: z.union([vertexModels, z.literal("")]).optional(),
  enabled: z.boolean(),
})
export type UpdatePlatformAiSettingsSchema = z.infer<
  typeof updatePlatformAiSettingsSchema
>
