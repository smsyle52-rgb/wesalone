import z from "zod"

// Fixed to "vertex" today. Kept as an enum (not a literal) so a future
// platform-wide provider change is a value addition, not a schema rewrite.
export const platformAiProviders = z.enum(["vertex"])
export type PlatformAiProvider = z.infer<typeof platformAiProviders>

// Capability providers are intentionally broader than the singleton platform
// provider. This keeps each AI workload independently replaceable without a
// schema migration: "workspace" delegates to the provider selected in the
// flow/agent, while the Google-backed providers use platform ADC.
export const platformAiCapabilityProviders = z.enum([
  "vertex",
  "googleCloud",
  "workspace",
  "local",
])
export type PlatformAiCapabilityProvider = z.infer<
  typeof platformAiCapabilityProviders
>

export const platformAiCapabilitySchema = z.object({
  provider: platformAiCapabilityProviders,
  model: z.string().trim().min(1),
  fallbackModel: z.string().trim().min(1).nullable().optional(),
  location: z.string().trim().min(1).nullable().optional(),
  voice: z.string().trim().min(1).nullable().optional(),
})
export type PlatformAiCapability = z.infer<typeof platformAiCapabilitySchema>

export const platformAiCapabilitiesSchema = z.object({
  vision: platformAiCapabilitySchema,
  embedding: platformAiCapabilitySchema,
  summarization: platformAiCapabilitySchema,
  extraction: platformAiCapabilitySchema,
  imageGeneration: platformAiCapabilitySchema,
  imageEditing: platformAiCapabilitySchema,
  speechToText: platformAiCapabilitySchema,
  textToSpeech: platformAiCapabilitySchema,
  webSearch: platformAiCapabilitySchema,
  documentParsing: platformAiCapabilitySchema,
  translation: platformAiCapabilitySchema,
})
export type PlatformAiCapabilities = z.infer<
  typeof platformAiCapabilitiesSchema
>
