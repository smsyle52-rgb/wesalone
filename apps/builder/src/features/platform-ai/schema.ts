import { vertexModels } from "@chatbotx.io/ai/models"
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
  chatModel: vertexModels,
  // Empty string / undefined both mean "no fallback configured" — the
  // SelectField's clear button sets `undefined`, the form default is "".
  fallbackModel: z.union([vertexModels, z.literal("")]).optional(),
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
