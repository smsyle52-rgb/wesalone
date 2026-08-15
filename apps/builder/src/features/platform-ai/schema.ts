import { platformAiCapabilityProviders } from "@chatbotx.io/database/partials"
import { z } from "zod"

const optionalCapabilityValue = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().trim().min(1).optional(),
)

const capabilitySchema = z.object({
  provider: platformAiCapabilityProviders,
  model: z.string().trim().min(1),
  fallbackModel: optionalCapabilityValue,
  location: optionalCapabilityValue,
  voice: optionalCapabilityValue,
})

export const updatePlatformAiSettingsSchema = z.object({
  // Azure uses deployment names, which are workspace-specific text values.
  chatModel: z.string().trim().min(1),
  // Empty string / undefined both mean "no fallback configured".
  fallbackModel: z.union([z.string().trim().min(1), z.literal("")]).optional(),
  location: z.string().trim().min(1),
  capabilities: z.object({
    vision: capabilitySchema,
    embedding: capabilitySchema,
    summarization: capabilitySchema,
    extraction: capabilitySchema,
    imageGeneration: capabilitySchema,
    imageEditing: capabilitySchema,
    speechToText: capabilitySchema,
    textToSpeech: capabilitySchema,
    webSearch: capabilitySchema,
    documentParsing: capabilitySchema,
    translation: capabilitySchema,
  }),
  enabled: z.boolean(),
})
export type UpdatePlatformAiSettingsSchema = z.infer<
  typeof updatePlatformAiSettingsSchema
>
