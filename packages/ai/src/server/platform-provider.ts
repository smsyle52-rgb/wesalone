import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai"
import {
  DEFAULT_PLATFORM_AI_CAPABILITIES,
  DEFAULT_PLATFORM_AI_CHAT_MODEL,
  DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
  platformAiSettingService,
} from "@chatbotx.io/business"
import type {
  PlatformAiCapabilities,
  PlatformAiCapability,
} from "@chatbotx.io/database/partials"
import type {
  EmbeddingModel,
  ImageModel,
  LanguageModel,
  TranscriptionModel,
} from "ai"
import { generateText } from "ai"
import { env } from "../keys"
import { logger } from "../logger"

export type PlatformAiOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
  endpoint: string
  apiKey: string
  capabilities: PlatformAiCapabilities
}

/**
 * Resolve the platform-wide Azure OpenAI override. The database still accepts
 * legacy `vertex` capability values so the copied Azure database can be moved
 * without touching the live Google production database; those values are
 * translated to the Azure deployment names at runtime and never authenticate
 * to Google.
 */
export async function getActivePlatformAiOverride(): Promise<PlatformAiOverride | null> {
  let active: Awaited<ReturnType<typeof platformAiSettingService.getActive>>
  try {
    active = await platformAiSettingService.getActive()
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[platform-ai] Failed to read the Azure OpenAI platform setting — falling back to each agent's own configured provider",
    )
    return null
  }

  if (!active) {
    return null
  }

  const endpoint = env.AZURE_OPENAI_ENDPOINT
  const apiKey = env.AZURE_OPENAI_API_KEY
  if (!(endpoint && apiKey)) {
    logger.error(
      "[platform-ai] Azure OpenAI is enabled in platform settings but endpoint or API key is not configured — falling back to each agent's own configured provider",
    )
    return null
  }

  const isLegacyVertexSetting =
    active.chatModel.startsWith("gemini") ||
    active.embeddingModel?.startsWith("text-embedding-") === true
  return {
    chatModel:
      env.AZURE_OPENAI_CHAT_DEPLOYMENT ??
      (isLegacyVertexSetting
        ? DEFAULT_PLATFORM_AI_CHAT_MODEL
        : active.chatModel),
    fallbackModel: isLegacyVertexSetting ? null : active.fallbackModel,
    location: env.AZURE_OPENAI_LOCATION ?? active.location,
    endpoint,
    apiKey,
    capabilities: active.capabilities ?? DEFAULT_PLATFORM_AI_CAPABILITIES,
  }
}

export type PlatformAiCapabilityName = keyof PlatformAiCapabilities

export type ResolvedPlatformAiCapability = PlatformAiCapability & {
  endpoint: string
  apiKey: string
  location: string
}

function usesPlatformAzureOpenAI(
  provider: PlatformAiCapability["provider"],
): boolean {
  // `vertex` is intentionally accepted only as a legacy database value during
  // the non-destructive copy to Azure. It is translated before model creation.
  return provider === "azureOpenAI" || provider === "vertex"
}

function resolveAzureDeploymentName(
  name: PlatformAiCapabilityName,
  capability: PlatformAiCapability,
  override: PlatformAiOverride,
): string {
  if (capability.provider !== "vertex") {
    return capability.model
  }

  if (name === "embedding") {
    return (
      env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ??
      DEFAULT_PLATFORM_AI_EMBEDDING_MODEL
    )
  }

  return env.AZURE_OPENAI_CHAT_DEPLOYMENT ?? override.chatModel
}

/** Resolve one independently configurable platform capability. */
export async function getActivePlatformAiCapability(
  name: PlatformAiCapabilityName,
): Promise<ResolvedPlatformAiCapability | null> {
  const override = await getActivePlatformAiOverride()
  if (!override) {
    return null
  }

  const capability =
    override.capabilities[name] ?? DEFAULT_PLATFORM_AI_CAPABILITIES[name]
  if (
    capability.provider === "workspace" ||
    capability.provider === "local" ||
    capability.provider === "googleCloud"
  ) {
    return null
  }

  if (!usesPlatformAzureOpenAI(capability.provider)) {
    return null
  }

  return {
    ...capability,
    provider: "azureOpenAI",
    model: resolveAzureDeploymentName(name, capability, override),
    endpoint: override.endpoint,
    apiKey: override.apiKey,
    location:
      capability.location ?? env.AZURE_OPENAI_LOCATION ?? override.location,
  }
}

export function getPlatformAzureOpenAIProvider(
  override: Pick<PlatformAiOverride, "endpoint" | "apiKey">,
): OpenAIProvider {
  return createOpenAI({
    baseURL: new URL("openai/v1", override.endpoint).toString(),
    apiKey: override.apiKey,
    headers: { "api-key": override.apiKey },
    name: "azure-openai",
  })
}

/**
 * Returns the Azure embedding deployment when the platform configuration is
 * active. text-embedding-3-small defaults to 1536 dimensions, matching the
 * existing pgvector schema and avoiding a destructive migration.
 */
export async function getPlatformEmbeddingModel(): Promise<EmbeddingModel | null> {
  const capability = await getActivePlatformAiCapability("embedding")
  if (!capability) {
    return null
  }
  return getPlatformAzureOpenAIProvider(capability).embeddingModel(
    capability.model,
  )
}

export async function getPlatformEmbeddingProviderOptions(
  _taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
) {
  const capability = await getActivePlatformAiCapability("embedding")
  if (!capability) {
    return
  }

  return {
    openai: {
      dimensions: 1536,
    },
  }
}

export type PlatformAiEnvStatus = {
  hasEndpoint: boolean
  hasApiKey: boolean
  hasLocationOverride: boolean
}

/** Presence-only check; no endpoint or secret is returned to the caller. */
export function getPlatformAiEnvStatus(): PlatformAiEnvStatus {
  return {
    hasEndpoint: !!env.AZURE_OPENAI_ENDPOINT,
    hasApiKey: !!env.AZURE_OPENAI_API_KEY,
    hasLocationOverride: !!env.AZURE_OPENAI_LOCATION,
  }
}

/** A synthetic, never-persisted platform candidate inside agent fallback loops. */
export type PlatformAzureOpenAIModelCandidate = {
  readonly platformAzureOpenAI: true
  readonly model: string
}

export function isPlatformAzureOpenAIModelCandidate(
  value: unknown,
): value is PlatformAzureOpenAIModelCandidate {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformAzureOpenAI?: unknown }).platformAzureOpenAI === true
  )
}

export function buildPlatformOverrideCandidates(
  override: PlatformAiOverride,
): PlatformAzureOpenAIModelCandidate[] {
  const candidates: PlatformAzureOpenAIModelCandidate[] = [
    { platformAzureOpenAI: true, model: override.chatModel },
  ]
  if (override.fallbackModel) {
    candidates.push({
      platformAzureOpenAI: true,
      model: override.fallbackModel,
    })
  }
  return candidates
}

export async function getPlatformCapabilityLanguageModel(
  name: "extraction" | "summarization" | "vision" | "webSearch",
): Promise<LanguageModel | null> {
  const capability = await getActivePlatformAiCapability(name)
  if (!capability) {
    return null
  }
  return getPlatformAzureOpenAIProvider(capability)(capability.model)
}

export async function getPlatformCapabilityImageModel(
  name: "imageEditing" | "imageGeneration",
): Promise<ImageModel | null> {
  const capability = await getActivePlatformAiCapability(name)
  if (!capability) {
    return null
  }
  return getPlatformAzureOpenAIProvider(capability).image(capability.model)
}

export async function getPlatformTranscriptionModel(): Promise<{
  model: TranscriptionModel
  modelId: string
  region: string
} | null> {
  const capability = await getActivePlatformAiCapability("speechToText")
  if (!capability) {
    return null
  }
  return {
    model: getPlatformAzureOpenAIProvider(capability).transcription(
      capability.model,
    ),
    modelId: capability.model,
    region: capability.location,
  }
}

export async function getPlatformTextToSpeechConfig(): Promise<ResolvedPlatformAiCapability | null> {
  return await getActivePlatformAiCapability("textToSpeech")
}

export function getPlatformAzureOpenAIChatModel(
  modelId: string,
  override: Pick<PlatformAiOverride, "endpoint" | "apiKey">,
): LanguageModel {
  return getPlatformAzureOpenAIProvider(override)(modelId)
}

/** A real, bounded inference probe used by the super-admin validation action. */
export async function probePlatformAzureOpenAIChatModel(props: {
  modelId: string
}): Promise<void> {
  const endpoint = env.AZURE_OPENAI_ENDPOINT
  const apiKey = env.AZURE_OPENAI_API_KEY
  if (!(endpoint && apiKey)) {
    throw new Error("Azure OpenAI endpoint or API key is not configured")
  }

  await generateText({
    model: getPlatformAzureOpenAIProvider({ endpoint, apiKey })(props.modelId),
    prompt: "Reply with OK.",
    maxOutputTokens: 4,
    temperature: 0,
    timeout: { totalMs: 20_000 },
  })
}
