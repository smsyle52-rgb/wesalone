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
import { defaultSettingsMiddleware, generateText, wrapLanguageModel } from "ai"
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

export type PlatformAzureFoundryChatConfig = {
  endpoint: string
  apiKey: string
  deployment: string
  model: string
}

/**
 * The optional first-choice chat model on an Azure AI Foundry resource. It is
 * addressed by its catalog model id (e.g. `muse-spark-1.3`), which is also what
 * the candidate carries, so no new candidate shape reaches queued job payloads.
 */
export function getPlatformAzureFoundryChatConfig(): PlatformAzureFoundryChatConfig | null {
  const endpoint = env.AZURE_FOUNDRY_CHAT_ENDPOINT
  const apiKey = env.AZURE_FOUNDRY_CHAT_API_KEY
  const deployment = env.AZURE_FOUNDRY_CHAT_DEPLOYMENT
  const model = env.AZURE_FOUNDRY_CHAT_MODEL
  if (!(endpoint && apiKey && deployment && model)) {
    return null
  }
  return { endpoint, apiKey, deployment, model }
}

export function isPlatformAzureFoundryChatModel(modelId: string): boolean {
  return getPlatformAzureFoundryChatConfig()?.model === modelId
}

/**
 * Build the external-account configuration for Google Workload Identity
 * Federation. Azure Container Apps supplies the endpoint and header for the
 * assigned managed identity at runtime; no Google service-account key or
 * access token is persisted in the application, database, or Key Vault.
 */
function getWifAudience(): string | null {
  const wifProjectNumber = env.VERTEX_AI_WIF_PROJECT_NUMBER
  const wifPoolId = env.VERTEX_AI_WIF_POOL_ID
  const wifProviderId = env.VERTEX_AI_WIF_PROVIDER_ID

  if (!(wifProjectNumber && wifPoolId && wifProviderId)) {
    return null
  }

  return `//iam.googleapis.com/projects/${wifProjectNumber}/locations/global/workloadIdentityPools/${wifPoolId}/providers/${wifProviderId}`
}

/**
 * AWS EC2 variant of the federation below. The instance profile's own IAM role
 * is the subject token source (signed GetCallerIdentity), so — exactly like the
 * Azure managed identity — no Google service-account key exists to leak. The
 * instance metadata service is reached over the link-local address; IMDSv2 is
 * handled by `imdsv2_session_token_url`.
 */
function getAwsGoogleAuthOptions(projectId: string): GoogleAuthOptions | null {
  const audience = getWifAudience()
  const region = env.AWS_REGION

  if (!(audience && region)) {
    return null
  }

  const metadata = "http://169.254.169.254"

  return {
    projectId,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    credentials: {
      type: "external_account",
      audience,
      subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
      token_url: "https://sts.googleapis.com/v1/token",
      credential_source: {
        environment_id: "aws1",
        region_url: `${metadata}/latest/meta-data/placement/availability-zone`,
        url: `${metadata}/latest/meta-data/iam/security-credentials`,
        regional_cred_verification_url: `https://sts.${region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15`,
        imdsv2_session_token_url: `${metadata}/latest/api/token`,
      },
    },
  }
}

export function getVertexGoogleAuthOptions(
  projectId: string,
): GoogleAuthOptions | null {
  if (env.VERTEX_AI_WIF_SOURCE === "aws") {
    return getAwsGoogleAuthOptions(projectId)
  }

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

/** Width of the pgvector columns (AIEmbedding, AIConversationEmbedding). */
const PLATFORM_EMBEDDING_DIMENSIONS = 1536

/**
 * Vertex embeddings, used instead of Azure OpenAI when
 * VERTEX_AI_EMBEDDING_MODEL is set. gemini-embedding-001 is asked for the same
 * 1536 dimensions the columns already hold, so switching needs no migration —
 * only a re-embed of the stored chunks, because the two providers' vector
 * spaces are not comparable.
 */
function getPlatformVertexEmbeddingModel(): EmbeddingModel | null {
  const modelId = env.VERTEX_AI_EMBEDDING_MODEL
  const projectId = env.VERTEX_AI_PROJECT_ID
  if (!(modelId && projectId)) {
    return null
  }
  const googleAuthOptions = getVertexGoogleAuthOptions(projectId)
  if (!googleAuthOptions) {
    return null
  }

  return createVertex({
    project: projectId,
    location: env.VERTEX_AI_EMBEDDING_LOCATION ?? "europe-west4",
    googleAuthOptions,
  }).embeddingModel(modelId)
}

/** Azure embeddings keep the existing pgvector columns at 1536 dimensions. */
export async function getPlatformEmbeddingModel(): Promise<EmbeddingModel | null> {
  const vertexModel = getPlatformVertexEmbeddingModel()
  if (vertexModel) {
    return vertexModel
  }

  const capability = await getActivePlatformAiCapability("embedding")
  if (capability?.provider !== "azureOpenAI") {
    return null
  }
  return getPlatformAzureOpenAIProvider(capability).embeddingModel(
    capability.model,
  )
}

export async function getPlatformEmbeddingProviderOptions(
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<Record<string, Record<string, string | number>> | undefined> {
  if (getPlatformVertexEmbeddingModel()) {
    return {
      vertex: {
        outputDimensionality: PLATFORM_EMBEDDING_DIMENSIONS,
        taskType,
      },
    }
  }

  const capability = await getActivePlatformAiCapability("embedding")
  if (capability?.provider !== "azureOpenAI") {
    return
  }

  return { openai: { dimensions: PLATFORM_EMBEDDING_DIMENSIONS } }
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
    const azureCandidate: PlatformModelCandidate = {
      platformAzureOpenAI: true,
      model: override.azureOpenAI.chatDeployment,
    }
    if (env.PLATFORM_AI_CHAT_PRIMARY === "azureOpenAI") {
      candidates.unshift(azureCandidate)
    } else {
      candidates.push(azureCandidate)
    }
    // The Foundry model answers first; every candidate above stays behind it
    // as the fallback for when its (small) quota is used up.
    const foundry = getPlatformAzureFoundryChatConfig()
    if (foundry) {
      candidates.unshift({ platformAzureOpenAI: true, model: foundry.model })
    }
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
    return withPlatformThinking(
      getPlatformVertexProvider(capability)(capability.model),
      capability.model,
    )
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
    model: getPlatformAzureOpenAITranscriptionProvider(
      capability,
      capability.model,
    ).transcription(capability.model),
    modelId: capability.model,
    region: capability.location,
  }
}

/** API version of Azure's deployment-scoped audio endpoint. */
const AZURE_OPENAI_AUDIO_API_VERSION = "2024-06-01"
/** API version of Azure's deployment-scoped chat completions endpoint. */
const AZURE_FOUNDRY_CHAT_API_VERSION = "2024-10-21"

/**
 * Non-OpenAI Foundry models are not served on the `/openai/v1` Responses
 * surface (measured 2 Oct 2026 with muse-spark-1.3: 400 on Responses, and
 * `/openai/v1/chat/completions` cannot resolve the deployment). They answer —
 * tool calls and streaming included — only on the deployment-scoped Chat
 * Completions path, with the catalog model id in the request body.
 */
function getPlatformAzureFoundryChatModel(
  config: PlatformAzureFoundryChatConfig,
): LanguageModel {
  return createOpenAI({
    baseURL: new URL(
      `openai/deployments/${encodeURIComponent(config.deployment)}`,
      config.endpoint,
    ).toString(),
    apiKey: config.apiKey,
    headers: { "api-key": config.apiKey },
    name: "azure-openai",
    fetch: (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input.toString()
          : input.url,
      )
      url.searchParams.set("api-version", AZURE_FOUNDRY_CHAT_API_VERSION)
      return fetch(url, init)
    },
  }).chat(config.model)
}

/**
 * Azure serves Whisper only on the deployment-scoped path
 * (`/openai/deployments/<name>/audio/transcriptions?api-version=…`); the
 * `/openai/v1` surface the chat provider uses answers DeploymentNotFound for
 * it (measured 2 Oct 2026). So transcription gets its own base URL, and the
 * mandatory `api-version` is added to each request.
 */
function getPlatformAzureOpenAITranscriptionProvider(
  override: Pick<PlatformAzureOpenAIConfig, "endpoint" | "apiKey">,
  deployment: string,
): OpenAIProvider {
  return createOpenAI({
    baseURL: new URL(
      `openai/deployments/${encodeURIComponent(deployment)}`,
      override.endpoint,
    ).toString(),
    apiKey: override.apiKey,
    headers: { "api-key": override.apiKey },
    name: "azure-openai",
    fetch: (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input.toString()
          : input.url,
      )
      url.searchParams.set("api-version", AZURE_OPENAI_AUDIO_API_VERSION)
      return fetch(url, init)
    },
  })
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

const GEMINI_THINKING_LEVEL_MODEL = /^gemini-3/

/**
 * Applies the platform's default Gemini thinking level to a Vertex language
 * model. Default (dynamic) thinking made even trivial customer replies take
 * 24–45s at peak and hit the 60s step timeout; measured 2026-09-23 on the
 * production project with five realistic Arabic store prompts, gemini-3.7-flash
 * at `low` answered in a 4.7s median (8.2s max) with no 429s. Only Gemini 3.x
 * accepts `thinkingLevel`, so older models are returned untouched, and a
 * per-call `providerOptions` still overrides this default.
 */
function withPlatformThinking(
  model: ReturnType<GoogleVertexProvider>,
  modelId: string,
): LanguageModel {
  const level = env.VERTEX_AI_THINKING_LEVEL ?? "low"
  if (level === "default" || !GEMINI_THINKING_LEVEL_MODEL.test(modelId)) {
    return model
  }

  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          vertex: { thinkingConfig: { thinkingLevel: level } },
        },
      },
    }),
  })
}

export function getPlatformVertexChatModel(
  modelId: string,
  override: Pick<PlatformAiOverride, "location" | "projectId">,
): LanguageModel {
  return withPlatformThinking(
    getPlatformVertexProvider(override)(modelId),
    modelId,
  )
}

export function getPlatformAzureOpenAIChatModel(
  modelId: string,
  override: Pick<PlatformAzureOpenAIConfig, "endpoint" | "apiKey">,
): LanguageModel {
  const foundry = getPlatformAzureFoundryChatConfig()
  if (foundry?.model === modelId) {
    return getPlatformAzureFoundryChatModel(foundry)
  }
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
