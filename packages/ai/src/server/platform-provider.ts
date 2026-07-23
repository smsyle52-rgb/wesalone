import { createVertex } from "@ai-sdk/google-vertex"
import { platformAiSettingService } from "@chatbotx.io/business"
import type { LanguageModel } from "ai"
import { env } from "../keys"
import { logger } from "../logger"

export type PlatformAiOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
  projectId: string
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

function getPlatformVertexProvider(
  override: Pick<PlatformAiOverride, "location" | "projectId">,
) {
  // No apiKey passed → the provider skips "express mode" and authenticates
  // via googleAuthOptions, which defaults to google-auth-library's normal ADC
  // chain (Cloud Run service account in production). Never a stored secret.
  return createVertex({
    project: override.projectId,
    location: override.location,
  })
}

export function getPlatformVertexChatModel(
  modelId: string,
  override: Pick<PlatformAiOverride, "location" | "projectId">,
): LanguageModel {
  return getPlatformVertexProvider(override)(modelId)
}
