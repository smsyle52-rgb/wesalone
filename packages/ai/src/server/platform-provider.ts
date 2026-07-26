import { createVertex, type GoogleVertexProvider } from "@ai-sdk/google-vertex"
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
import { env } from "../keys"
import { logger } from "../logger"

export type PlatformAiOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
  projectId: string
  capabilities: PlatformAiCapabilities
}

/**
 * Resolution of the platform-wide Vertex override (the DB read behind it is
 * already cached in `platformAiSettingService.getActive`).
 *
 * Returns `null` whenever the setting is disabled, unset, misconfigured
 * (missing `VERTEX_AI_PROJECT_ID`), OR the DB read itself fails for any
 * reason (including the `PlatformAiSetting` table not existing yet, e.g. this
 * code deployed before its migration ran) — every one of those cases means
 * "fall through to the agent's own configured provider/model, exactly as
 * before," never a half-enabled broken state. This is the single check every
 * runtime call site needs, and it must never throw:
 * Platform AI call sites resolve this override before entering their own
 * provider fallback handling, so this function must never throw.
 * so a thrown error here would break reply generation for
 * every agent in every workspace over an infra/deploy-ordering problem, not
 * just make Vertex unavailable. Every failure mode is still surfaced loudly
 * via `logger.error` below.
 */
export async function getActivePlatformAiOverride(): Promise<PlatformAiOverride | null> {
  let active: Awaited<ReturnType<typeof platformAiSettingService.getActive>>
  try {
    active = await platformAiSettingService.getActive()
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
      },
      "[platform-ai] Failed to read the platform Vertex setting (e.g. migration not applied yet) — falling back to each agent's own configured provider",
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

  return {
    chatModel: active.chatModel,
    fallbackModel: active.fallbackModel,
    location: env.VERTEX_AI_LOCATION ?? active.location,
    projectId,
    capabilities: active.capabilities ?? DEFAULT_PLATFORM_AI_CAPABILITIES,
  }
}

export type PlatformAiCapabilityName = keyof PlatformAiCapabilities

export type ResolvedPlatformAiCapability = PlatformAiCapability & {
  projectId: string
  location: string
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
  if (capability.provider === "workspace" || capability.provider === "local") {
    return null
  }

  return {
    ...capability,
    projectId: override.projectId,
    location:
      capability.location ?? env.VERTEX_AI_LOCATION ?? override.location,
  }
}

/**
 * The platform's Vertex embedding model, when one is configured.
 *
 * Retrieval has to embed the incoming query with the *same* model that
 * embedded the stored chunks — vectors from different models are not
 * comparable, and differing dimensions fail outright at the pgvector
 * comparison. Resolving it from the same platform setting the indexer follows
 * keeps both halves in lockstep and means a workspace needs no key of its own.
 *
 * Returns `null` under exactly the conditions {@link getActivePlatformAiOverride}
 * does (disabled, unset, missing project id, or an unreadable setting), plus
 * when the setting predates the embedding field — every one of which means
 * "fall through to the workspace's own provider", never a broken half-state.
 * Like its sibling, this must never throw: retrieval runs inside a tool call
 * whose failure surfaces to the customer as "I found nothing".
 */
export async function getPlatformEmbeddingModel(): Promise<EmbeddingModel | null> {
  let active: Awaited<ReturnType<typeof platformAiSettingService.getActive>>
  try {
    active = await platformAiSettingService.getActive()
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[platform-ai] Failed to read the platform Vertex setting for embeddings — falling back to the workspace's own provider",
    )
    return null
  }

  if (!active) {
    return null
  }

  const capability =
    active.capabilities?.embedding ?? DEFAULT_PLATFORM_AI_CAPABILITIES.embedding
  if (capability.provider !== "vertex") {
    return null
  }

  const embeddingModel = capability.model || active.embeddingModel
  if (!embeddingModel) {
    return null
  }

  const projectId = env.VERTEX_AI_PROJECT_ID
  if (!projectId) {
    logger.error(
      "[platform-ai] Vertex is enabled but VERTEX_AI_PROJECT_ID is not configured — falling back to the workspace's own embedding provider",
    )
    return null
  }

  const vertex = createVertex({
    project: projectId,
    location: capability.location ?? env.VERTEX_AI_LOCATION ?? active.location,
  })

  return vertex.textEmbeddingModel(embeddingModel)
}

export async function getPlatformEmbeddingProviderOptions(
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
) {
  const capability = await getActivePlatformAiCapability("embedding")
  if (
    capability?.provider !== "vertex" ||
    !capability.model.startsWith("gemini-embedding")
  ) {
    return
  }

  // The existing pgvector columns are vector(1536). Gemini embeddings support
  // an explicit output size, which lets us upgrade models without a disruptive
  // vector-column migration.
  return {
    googleVertex: {
      outputDimensionality: 1536,
      taskType,
    },
  }
}

export type PlatformAiEnvStatus = {
  hasProjectId: boolean
  hasLocationOverride: boolean
}

/**
 * Presence-only env check for the admin "validate configuration" action —
 * never returns the actual project id/location values, only whether they're
 * set, so the response can never leak a secret or infra identifier.
 */
export function getPlatformAiEnvStatus(): PlatformAiEnvStatus {
  return {
    hasProjectId: !!env.VERTEX_AI_PROJECT_ID,
    hasLocationOverride: !!env.VERTEX_AI_LOCATION,
  }
}

/**
 * A synthetic, never-persisted stand-in for one entry of an agent's stored
 * `models` fallback chain. Deliberately NOT a member of `AIAgentModelConfig` —
 * it only ever exists in-memory inside the worker's model-resolution step, so
 * widening the real (DB-backed, customer-facing) provider schema is never
 * required to support it.
 */
export type PlatformVertexModelCandidate = {
  readonly platformVertex: true
  readonly model: string
}

export function isPlatformVertexModelCandidate(
  value: unknown,
): value is PlatformVertexModelCandidate {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformVertex?: unknown }).platformVertex === true
  )
}

/**
 * Primary + optional fallback, both within Vertex — mirrors the shape of the
 * existing per-agent fallback chain so callers can reuse the same "try each
 * candidate, stop at the first that responds" loop unchanged.
 */
export function buildPlatformOverrideCandidates(
  override: PlatformAiOverride,
): PlatformVertexModelCandidate[] {
  const candidates: PlatformVertexModelCandidate[] = [
    { platformVertex: true, model: override.chatModel },
  ]
  if (override.fallbackModel) {
    candidates.push({ platformVertex: true, model: override.fallbackModel })
  }
  return candidates
}

export function getPlatformVertexProvider(
  override: Pick<PlatformAiOverride, "location" | "projectId">,
): GoogleVertexProvider {
  // No apiKey passed → the provider skips "express mode" and authenticates
  // via googleAuthOptions, which defaults to google-auth-library's normal ADC
  // chain (Cloud Run service account in production). Never a stored secret.
  return createVertex({
    project: override.projectId,
    location: override.location,
  })
}

export async function getPlatformCapabilityLanguageModel(
  name: "extraction" | "summarization" | "vision" | "webSearch",
): Promise<LanguageModel | null> {
  const capability = await getActivePlatformAiCapability(name)
  if (capability?.provider !== "vertex") {
    return null
  }
  return getPlatformVertexProvider(capability)(capability.model)
}

export async function getPlatformCapabilityImageModel(
  name: "imageEditing" | "imageGeneration",
): Promise<ImageModel | null> {
  const capability = await getActivePlatformAiCapability(name)
  if (capability?.provider !== "vertex") {
    return null
  }
  return getPlatformVertexProvider(capability).image(capability.model)
}

export async function getPlatformTranscriptionModel(): Promise<{
  model: TranscriptionModel
  modelId: string
  region: string
} | null> {
  const capability = await getActivePlatformAiCapability("speechToText")
  if (capability?.provider !== "vertex") {
    return null
  }
  return {
    model: getPlatformVertexProvider(capability).transcription(
      capability.model,
    ),
    modelId: capability.model,
    region: capability.location,
  }
}

export async function getPlatformTextToSpeechConfig(): Promise<ResolvedPlatformAiCapability | null> {
  const capability = await getActivePlatformAiCapability("textToSpeech")
  return capability?.provider === "googleCloud" ? capability : null
}

export function getPlatformVertexChatModel(
  modelId: string,
  override: Pick<PlatformAiOverride, "location" | "projectId">,
): LanguageModel {
  return getPlatformVertexProvider(override)(modelId)
}

/** A real inference probe used by the super-admin validation action. */
export async function probePlatformVertexChatModel(props: {
  location: string
  modelId: string
}): Promise<void> {
  const projectId = env.VERTEX_AI_PROJECT_ID
  if (!projectId) {
    throw new Error("VERTEX_AI_PROJECT_ID is not configured")
  }

  await generateText({
    model: getPlatformVertexProvider({
      projectId,
      location: props.location,
    })(props.modelId),
    prompt: "Reply with OK.",
    maxOutputTokens: 4,
    temperature: 0,
    timeout: { totalMs: 20_000 },
  })
}
