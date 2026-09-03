import { createVertex, type GoogleVertexProvider } from "@ai-sdk/google-vertex"
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai"
import {
  DEFAULT_PLATFORM_AI_CAPABILITIES,
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
import type { GoogleAuthOptions } from "google-auth-library"
import { env } from "../keys"
import { logger } from "../logger"

export type PlatformAzureOpenAIConfig = {
  endpoint: string
  apiKey: string
  location: string
  chatDeployment: string
  embeddingDeployment: string
}

export type PlatformAiOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
  projectId: string
  capabilities: PlatformAiCapabilities
  azureOpenAI: PlatformAzureOpenAIConfig | null
}

function getPlatformAzureOpenAIConfig(): PlatformAzureOpenAIConfig | null {
  const endpoint = env.AZURE_OPENAI_ENDPOINT
  const apiKey = env.AZURE_OPENAI_API_KEY
  const chatDeployment = env.AZURE_OPENAI_CHAT_DEPLOYMENT
  const embeddingDeployment = env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
  if (!(endpoint && apiKey && chatDeployment && embeddingDeployment)) {
    return null
  }

  return {
    endpoint,
    apiKey,
    chatDeployment,
    embeddingDeployment,
    location: env.AZURE_OPENAI_LOCATION ?? "uaenorth",
  }
}

/**
 * Build the external-account configuration for Google Workload Identity
 * Federation. Azure Container Apps supplies the endpoint and header for the
 * assigned managed identity at runtime; no Google service-account key or
 * access token is persisted in the application, database, or Key Vault.
 */
export function getVertexGoogleAuthOptions(
  projectId: string,
): GoogleAuthOptions | null {
  const identityEndpoint = env.IDENTITY_ENDPOINT
  const identityHeader = env.IDENTITY_HEADER
  const managedIdentityClientId = env.AZURE_MANAGED_IDENTITY_CLIENT_ID
  const azureAudience = env.VERTEX_AI_AZURE_AUDIENCE
  const wifProjectNumber = env.VERTEX_AI_WIF_PROJECT_NUMBER
  const wifPoolId = env.VERTEX_AI_WIF_POOL_ID
  const wifProviderId = env.VERTEX_AI_WIF_PROVIDER_ID

  if (
    !(
      identityEndpoint &&
      identityHeader &&
      managedIdentityClientId &&
      azureAudience &&
      wifProjectNumber &&
      wifPoolId &&
      wifProviderId
    )
  ) {
    return null
  }

  const subjectTokenUrl = new URL(identityEndpoint)
  subjectTokenUrl.searchParams.set("api-version", "2019-08-01")
  subjectTokenUrl.searchParams.set("resource", azureAudience)
  subjectTokenUrl.searchParams.set("client_id", managedIdentityClientId)

  return {
    projectId,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    credentials: {
      type: "external_account",
      audience: `//iam.googleapis.com/projects/${wifProjectNumber}/locations/global/workloadIdentityPools/${wifPoolId}/providers/${wifProviderId}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      credential_source: {
        url: subjectTokenUrl.toString(),
        headers: { "X-IDENTITY-HEADER": identityHeader },
        format: { type: "json", subject_token_field_name: "access_token" },
      },
    },
  }
}

/**
 * Resolves the platform-wide Vertex override. Any WIF/configuration failure is
 * fail-closed: the platform override is ignored and the original per-agent
 * provider chain stays available. Azure OpenAI is carried as a synthetic last
 * candidate only when its existing deployment configuration is complete.
 */
export async function getActivePlatformAiOverride(): Promise<PlatformAiOverride | null> {
  let active: Awaited<ReturnType<typeof platformAiSettingService.getActive>>
  try {
    active = await platformAiSettingService.getActive()
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[platform-ai] Failed to read the platform Vertex setting — falling back to each agent's own configured provider",
    )
    return null
  }

  if (!active) {
    return null
  }

  const projectId = env.VERTEX_AI_PROJECT_ID
  if (!projectId) {
    logger.error(
      "[platform-ai] Vertex is enabled in platform settings but VERTEX_AI_PROJECT_ID is not configured — falling back to each agent's own configured provider",
    )
    return null
  }

  if (!getVertexGoogleAuthOptions(projectId)) {
    logger.error(
      "[platform-ai] Vertex is enabled but the Azure Workload Identity Federation configuration is incomplete — falling back to each agent's own configured provider",
    )
    return null
  }

  return {
    chatModel: active.chatModel,
    fallbackModel: active.fallbackModel,
    location: env.VERTEX_AI_LOCATION ?? active.location,
    projectId,
    capabilities: active.capabilities ?? DEFAULT_PLATFORM_AI_CAPABILITIES,
    azureOpenAI: getPlatformAzureOpenAIConfig(),
  }
}

export type PlatformAiCapabilityName = keyof PlatformAiCapabilities

export type ResolvedPlatformVertexCapability = PlatformAiCapability & {
  provider: "vertex"
  projectId: string
  location: string
}

export type ResolvedPlatformAzureOpenAICapability = PlatformAiCapability & {
  provider: "azureOpenAI"
  endpoint: string
  apiKey: string
  location: string
}

export type ResolvedPlatformAiCapability =
  | ResolvedPlatformVertexCapability
  | ResolvedPlatformAzureOpenAICapability

/** Resolve one independently configurable platform capability. */
export async function getActivePlatformAiCapability(
  name: PlatformAiCapabilityName,
): Promise<ResolvedPlatformAiCapability | null> {
  const override = await getActivePlatformAiOverride()
  if (!override) {
    return null
  }

  // Do not move existing vectors to Gemini. The Azure deployment remains the
  // sole platform embedding path and preserves the existing 1536 dimensions.
  if (name === "embedding") {
    if (!override.azureOpenAI) {
      return null
    }
    return {
      provider: "azureOpenAI",
      model: override.azureOpenAI.embeddingDeployment,
      location: override.azureOpenAI.location,
      endpoint: override.azureOpenAI.endpoint,
      apiKey: override.azureOpenAI.apiKey,
    }
  }

  const capability =
    override.capabilities[name] ?? DEFAULT_PLATFORM_AI_CAPABILITIES[name]
  if (capability.provider === "workspace" || capability.provider === "local") {
    return null
  }

  if (
    capability.provider === "vertex" ||
    capability.provider === "googleCloud"
  ) {
    return {
      ...capability,
      provider: "vertex",
      projectId: override.projectId,
      location:
        capability.location ?? env.VERTEX_AI_LOCATION ?? override.location,
    }
  }

  if (capability.provider === "azureOpenAI" && override.azureOpenAI) {
    return {
      ...capability,
      provider: "azureOpenAI",
      endpoint: override.azureOpenAI.endpoint,
      apiKey: override.azureOpenAI.apiKey,
      location:
        capability.location ??
        env.AZURE_OPENAI_LOCATION ??
        override.azureOpenAI.location,
    }
  }

  return null
}

export function getPlatformAzureOpenAIProvider(
  override: Pick<PlatformAzureOpenAIConfig, "endpoint" | "apiKey">,
): OpenAIProvider {
  return createOpenAI({
    baseURL: new URL("openai/v1", override.endpoint).toString(),
    apiKey: override.apiKey,
    headers: { "api-key": override.apiKey },
    name: "azure-openai",
  })
}

export function getPlatformVertexProvider(
  override: Pick<PlatformAiOverride, "location" | "projectId">,
): GoogleVertexProvider {
  const googleAuthOptions = getVertexGoogleAuthOptions(override.projectId)
  if (!googleAuthOptions) {
    throw new Error("Azure Workload Identity Federation is not configured")
  }

  return createVertex({
    project: override.projectId,
    location: override.location,
    googleAuthOptions,
  })
}

/** Azure embeddings keep the existing pgvector columns at 1536 dimensions. */
export async function getPlatformEmbeddingModel(): Promise<EmbeddingModel | null> {
  const capability = await getActivePlatformAiCapability("embedding")
  if (capability?.provider !== "azureOpenAI") {
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
  if (capability?.provider !== "azureOpenAI") {
    return
  }

  return { openai: { dimensions: 1536 } }
}

export type PlatformAiEnvStatus = {
  hasVertexProjectId: boolean
  hasVertexLocationOverride: boolean
  hasWorkloadIdentityFederation: boolean
  hasAzureOpenAIFallback: boolean
}

/** Presence-only check; no endpoint, identifier, header, or secret is returned. */
export function getPlatformAiEnvStatus(): PlatformAiEnvStatus {
  return {
    hasVertexProjectId: !!env.VERTEX_AI_PROJECT_ID,
    hasVertexLocationOverride: !!env.VERTEX_AI_LOCATION,
    hasWorkloadIdentityFederation: !!getVertexGoogleAuthOptions(
      env.VERTEX_AI_PROJECT_ID ?? "unconfigured-project",
    ),
    hasAzureOpenAIFallback: !!getPlatformAzureOpenAIConfig(),
  }
}

export type PlatformVertexModelCandidate = {
  readonly platformVertex: true
  readonly model: string
}

export type PlatformAzureOpenAIModelCandidate = {
  readonly platformAzureOpenAI: true
  readonly model: string
}

export type PlatformModelCandidate =
  | PlatformVertexModelCandidate
  | PlatformAzureOpenAIModelCandidate

export function isPlatformVertexModelCandidate(
  value: unknown,
): value is PlatformVertexModelCandidate {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformVertex?: unknown }).platformVertex === true
  )
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

/**
 * The chat candidate order is Vertex primary, optional allowlisted Vertex
 * fallback, then Azure OpenAI. The final Azure candidate is injected in memory
 * only; no agent model list or database record is changed.
 */
export function buildPlatformOverrideCandidates(
  override: PlatformAiOverride,
): PlatformModelCandidate[] {
  const candidates: PlatformModelCandidate[] = [
    { platformVertex: true, model: override.chatModel },
  ]
  if (override.fallbackModel?.startsWith("gemini-")) {
    candidates.push({ platformVertex: true, model: override.fallbackModel })
  }
  if (override.azureOpenAI) {
    candidates.push({
      platformAzureOpenAI: true,
      model: override.azureOpenAI.chatDeployment,
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
  if (capability.provider === "vertex") {
    return getPlatformVertexProvider(capability)(capability.model)
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
  if (capability.provider === "vertex") {
    return getPlatformVertexProvider(capability).image(capability.model)
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
  if (capability.provider === "vertex") {
    return {
      model: getPlatformVertexProvider(capability).transcription(
        capability.model,
      ),
      modelId: capability.model,
      region: capability.location,
    }
  }
  return {
    model: getPlatformAzureOpenAIProvider(capability).transcription(
      capability.model,
    ),
    modelId: capability.model,
    region: capability.location,
  }
}

/**
 * Narrowed to the Vertex branch deliberately: the runtime check below already
 * guarantees it, and callers need `projectId` off the result to build the
 * Workload Identity Federation credential. Returning the wider union hid that
 * field behind a type error and left the caller authenticating with nothing.
 */
export async function getPlatformTextToSpeechConfig(): Promise<ResolvedPlatformVertexCapability | null> {
  const capability = await getActivePlatformAiCapability("textToSpeech")
  return capability?.provider === "vertex" ? capability : null
}

export function getPlatformVertexChatModel(
  modelId: string,
  override: Pick<PlatformAiOverride, "location" | "projectId">,
): LanguageModel {
  return getPlatformVertexProvider(override)(modelId)
}

export function getPlatformAzureOpenAIChatModel(
  modelId: string,
  override: Pick<PlatformAzureOpenAIConfig, "endpoint" | "apiKey">,
): LanguageModel {
  return getPlatformAzureOpenAIProvider(override)(modelId)
}

/** A bounded inference probe used by the super-admin validation action. */
export async function probePlatformVertexChatModel(props: {
  location: string
  modelId: string
}): Promise<void> {
  const override = await getActivePlatformAiOverride()
  if (!override) {
    throw new Error("Vertex platform override is not configured")
  }

  await generateText({
    model: getPlatformVertexProvider({
      projectId: override.projectId,
      location: props.location,
    })(props.modelId),
    prompt: "Reply with OK.",
    maxOutputTokens: 4,
    temperature: 0,
    timeout: { totalMs: 20_000 },
  })
}

export async function probePlatformAzureOpenAIFallback(): Promise<void> {
  const override = await getActivePlatformAiOverride()
  if (!override?.azureOpenAI) {
    throw new Error("Azure OpenAI fallback is not configured")
  }

  await generateText({
    model: getPlatformAzureOpenAIChatModel(
      override.azureOpenAI.chatDeployment,
      override.azureOpenAI,
    ),
    prompt: "Reply with OK.",
    maxOutputTokens: 4,
    temperature: 0,
    timeout: { totalMs: 20_000 },
  })
}

export {
  DEFAULT_PLATFORM_AI_CHAT_MODEL,
  DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
} from "@chatbotx.io/business"
