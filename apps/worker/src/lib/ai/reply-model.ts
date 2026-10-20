import {
  type AIProviderInstance,
  createAIProviderInstance,
  createOpenaiCompatibleModelInstance,
  getActivePlatformAiOverride,
  getAIIntegrationInDB,
  getPlatformAzureOpenAIChatModel,
  getPlatformAzureOpenAIProvider,
  getPlatformVertexChatModel,
  getPlatformVertexProvider,
  isPlatformAzureFoundryChatModel,
  isPlatformAzureOpenAIModelCandidate,
  isPlatformVertexModelCandidate,
  type PlatformModelCandidate,
} from "@chatbotx.io/ai/server"
import { integrationOpenaiCompatibleService } from "@chatbotx.io/business"
import type {
  AIAgentModelConfig,
  AIAgentOpenaiCompatibleProviderModel,
  AIAgentProvider,
} from "@chatbotx.io/database/partials"
import type { LanguageModel } from "ai"
import { logger } from "../logger"

export type ReplyAIProvider =
  | AIAgentProvider
  | "vertex"
  | "azureOpenAI"
  | "openaiCompatible"

/**
 * What a reply can run on: the agent's own configured model, or — on Wesal One —
 * a platform candidate from the admin AI override (Vertex first, Azure OpenAI as
 * the fallback), which needs no workspace key.
 */
export type ReplyModelProviderInfo = AIAgentModelConfig | PlatformModelCandidate

export function isOpenaiCompatibleProviderModel(
  providerInfo: ReplyModelProviderInfo,
): providerInfo is AIAgentOpenaiCompatibleProviderModel {
  return "kind" in providerInfo && providerInfo.kind === "openaiCompatible"
}

export function getProviderName(
  providerInfo: ReplyModelProviderInfo,
): ReplyAIProvider {
  if (isPlatformVertexModelCandidate(providerInfo)) {
    return "vertex"
  }
  if (isPlatformAzureOpenAIModelCandidate(providerInfo)) {
    return "azureOpenAI"
  }
  return isOpenaiCompatibleProviderModel(providerInfo)
    ? "openaiCompatible"
    : providerInfo.provider
}

/**
 * A model billed to the merchant's own OpenRouter key. Only OpenRouter: the
 * per-workspace Gemini keys left over from August must not take over again.
 */
export function isMerchantKeyProvider(
  providerInfo: ReplyModelProviderInfo,
): boolean {
  return (
    !isPlatformVertexModelCandidate(providerInfo) &&
    !isPlatformAzureOpenAIModelCandidate(providerInfo) &&
    !isOpenaiCompatibleProviderModel(providerInfo) &&
    providerInfo.provider === "openrouter"
  )
}

/**
 * The candidates a reply tries, in order. With the platform override on, an
 * agent whose first model is the merchant's own OpenRouter key answers on it
 * first and keeps the platform chain behind it; every other agent gets the
 * platform chain alone, exactly as before.
 */
export function resolveReplyProviders(
  agentModels: AIAgentModelConfig[],
  platformCandidates: PlatformModelCandidate[] | null,
): ReplyModelProviderInfo[] {
  if (!platformCandidates) {
    return agentModels
  }
  const first = agentModels[0]
  if (!(first && isMerchantKeyProvider(first))) {
    return platformCandidates
  }
  return [...agentModels.filter(isMerchantKeyProvider), ...platformCandidates]
}

/**
 * The Foundry model's quota is small and a fallback candidate follows it, so a
 * rate-limited call must fail over at once instead of sitting in the SDK's
 * retry backoff (which honours `retry-after`, up to a minute) while the
 * customer waits. `undefined` keeps the SDK default for every other model.
 */
export function replyModelMaxRetries(
  providerInfo: ReplyModelProviderInfo,
): number | undefined {
  return isPlatformAzureOpenAIModelCandidate(providerInfo) &&
    isPlatformAzureFoundryChatModel(providerInfo.model)
    ? 0
    : undefined
}

export async function createReplyModel(props: {
  providerInfo: ReplyModelProviderInfo
  workspaceId: string
}): Promise<null | {
  model: LanguageModel
  providerInstance?: AIProviderInstance
}> {
  const { providerInfo, workspaceId } = props

  if (isPlatformVertexModelCandidate(providerInfo)) {
    const override = await getActivePlatformAiOverride()
    if (!override) {
      return null
    }
    const providerInstance = getPlatformVertexProvider(override)
    return {
      model: getPlatformVertexChatModel(providerInfo.model, override),
      providerInstance,
    }
  }

  if (isPlatformAzureOpenAIModelCandidate(providerInfo)) {
    const override = await getActivePlatformAiOverride()
    // Setting flipped off, or the fallback was removed, between the loop
    // starting and this call — continue like any unavailable integration.
    if (!override?.azureOpenAI) {
      return null
    }
    // The Foundry model has no OpenAI provider-native tools (web search), so
    // it gets no provider instance and that tool is reported as unsupported.
    const providerInstance = isPlatformAzureFoundryChatModel(providerInfo.model)
      ? undefined
      : getPlatformAzureOpenAIProvider(override.azureOpenAI)
    return {
      model: getPlatformAzureOpenAIChatModel(
        providerInfo.model,
        override.azureOpenAI,
      ),
      providerInstance,
    }
  }

  if (isOpenaiCompatibleProviderModel(providerInfo)) {
    const integration =
      await integrationOpenaiCompatibleService.findByWorkspaceIdAndId({
        workspaceId,
        id: providerInfo.integrationId,
      })

    if (!(integration?.enabled && integration.autoReply)) {
      logger.debug(
        {
          workspaceId,
          integrationId: providerInfo.integrationId,
          integrationFound: Boolean(integration),
          enabled: integration?.enabled ?? null,
          autoReply: integration?.autoReply ?? null,
        },
        "[automated-response] openaiCompatible provider skipped: integration missing, disabled, or auto-reply off",
      )
      return null
    }

    return {
      model: createOpenaiCompatibleModelInstance({
        integration,
        modelId: providerInfo.model,
      }),
    }
  }

  const integration = await getAIIntegrationInDB({
    workspaceId,
    provider: providerInfo.provider,
    autoReply: true,
  })

  if (!integration) {
    logger.debug(
      { workspaceId, provider: providerInfo.provider },
      "[automated-response] provider skipped: no auto-reply-enabled integration found",
    )
    return null
  }

  const providerInstance = createAIProviderInstance({
    model: integration,
    provider: providerInfo.provider,
  })

  return {
    model: providerInstance(providerInfo.model),
    providerInstance,
  }
}
