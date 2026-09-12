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
 * Wesal One: a reply runs either on an agent's own model config or on a
 * platform override candidate (Vertex primary/fallback, then Azure OpenAI) —
 * merchants have no provider key of their own.
 */
export type ReplyProviderInfo = AIAgentModelConfig | PlatformModelCandidate

export function isOpenaiCompatibleProviderModel(
  providerInfo: ReplyProviderInfo,
): providerInfo is AIAgentOpenaiCompatibleProviderModel {
  return "kind" in providerInfo && providerInfo.kind === "openaiCompatible"
}

export function getProviderName(
  providerInfo: ReplyProviderInfo,
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

export async function createReplyModel(props: {
  providerInfo: ReplyProviderInfo
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
    const providerInstance = getPlatformAzureOpenAIProvider(
      override.azureOpenAI,
    )
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
