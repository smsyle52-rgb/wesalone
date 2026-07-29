import {
  aiTimeouts,
  helpTexts,
  processStreamingText,
  systemFunctionNames,
  toolPrefixes,
} from "@chatbotx.io/ai"
import {
  aiContextService,
  aiIntegrationService,
  appendFabricationGuard,
  appendKnowledgeBaseGuard,
  appendToolOutputGuard,
  createAIModelInstance,
  createOpenaiCompatibleModelInstance,
  getAIToolset,
  McpClient,
  normalizeMcpContent,
} from "@chatbotx.io/ai/server"
import {
  integrationOpenaiCompatibleService,
  type UsageReservation,
  usageMeteringService,
} from "@chatbotx.io/business"
import type {
  AIAgentModelConfig,
  AIAgentOpenaiCompatibleProviderModel,
  AIAgentProvider,
  AIAgentProviderModel,
  AIAgentProviderModels,
} from "@chatbotx.io/database/partials"
import type {
  AIAgentModel,
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { contactVariableService } from "@chatbotx.io/variables"
import { type ModelMessage, stepCountIs, streamText, type ToolSet } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../lib/logger"

export type ReplyByAIProps = {
  conversation: ConversationModel
  contactInbox: ContactInboxModel
  messages: ModelMessage[]
  aiAgent: AIAgentModel
  summary?: string
  preferredProvider?: AIAgentProvider
  preferredModel?: AIAgentModelConfig
  operationId: string
}

export type ReplyByAIExecutionResult = {
  responded: boolean
  provider: AIAgentProvider | "openaiCompatible"
  modelId: string
  usedFallbackText: boolean
  fullText: string
  toolStats: {
    steps: number
    toolCallsCount: number
    toolResultsCount: number
    toolErrorsCount: number
    toolNames: string[]
    finishReasons: Array<{
      stepNumber: number
      finishReason: string
      rawFinishReason?: string
    }>
  }
}

export async function runAIAgentRunner(
  props: ReplyByAIProps,
): Promise<null | ReplyByAIExecutionResult> {
  const { aiAgent, preferredModel, preferredProvider } = props
  const providers = aiAgent.models as AIAgentProviderModels
  let providersToRun = providers

  if (preferredModel) {
    providersToRun = [preferredModel]
  } else if (preferredProvider) {
    providersToRun = providers.filter(
      (providerInfo) =>
        isNativeProviderModel(providerInfo) &&
        providerInfo.provider === preferredProvider,
    )
  }

  const { tools, cleanup } = await getAIToolset({
    workspaceId: aiAgent.workspaceId,
    tools: aiAgent.tools,
    toolPrefixes: {
      file: toolPrefixes.enum.file,
      fn: toolPrefixes.enum.fn,
      mcp: toolPrefixes.enum.mcp,
      sys: toolPrefixes.enum.sys,
    },
    fileSearch: {
      fileSearchDescription: helpTexts.fileSearchDescription,
      fileSearchQueryDescription: helpTexts.fileSearchQueryDescription,
      fileSearchNoResult: helpTexts.fileSearchNoResult,
      fileSearchFoundPrefix: helpTexts.fileSearchFoundPrefix,
    },
    mcp: {
      McpClient,
      normalizeMcpContent,
    },
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)

  try {
    for (const providerInfo of providersToRun) {
      const result = await runAIReplyInternal(
        props,
        providerInfo,
        tools,
        controller.signal,
      )
      if (result?.responded) {
        return result
      }
    }
  } finally {
    clearTimeout(timeoutId)
    await cleanup()
  }

  return null
}

async function runAIReplyInternal(
  props: ReplyByAIProps,
  providerInfo: AIAgentModelConfig,
  tools: ToolSet,
  abortSignal: AbortSignal,
): Promise<null | ReplyByAIExecutionResult> {
  const { conversation, messages, aiAgent } = props
  const provider = getProviderName(providerInfo)
  let reservation: UsageReservation | undefined
  try {
    const selectedModelId = providerInfo.model
    const model = await createAgentModel({
      conversationId: conversation.id,
      providerInfo,
      workspaceId: conversation.workspaceId,
    })

    if (!model) {
      return null
    }

    reservation = await usageMeteringService.reserve({
      workspaceId: conversation.workspaceId,
      operationId: `${props.operationId}:${provider}:${selectedModelId}`,
      category: "language",
      provider,
      model: selectedModelId,
      metadata: { conversationId: conversation.id, aiAgentId: aiAgent.id },
    })

    const variables = await contactVariableService.getAll({
      contactId: conversation.contactId,
      contactInbox: props.contactInbox,
      conversation,
    })
    const promptBase = aiAgent.prompt
      ? await contactVariableService.replaceAll({
          text: aiAgent.prompt,
          variables,
        })
      : ""
    const completePrompt = props.summary
      ? `Conversation Context: ${props.summary}\n\n${promptBase}`
      : promptBase

    const systemPrompt = appendKnowledgeBaseGuard(
      appendFabricationGuard(appendToolOutputGuard(completePrompt), tools),
      tools,
    )

    const toolNamesSet = new Set<string>()
    const finishReasons: Array<{
      stepNumber: number
      finishReason: string
      rawFinishReason?: string
    }> = []
    let stepCount = 0
    let toolCallsCount = 0
    let webSearchesCount = 0
    let toolResultsCount = 0
    let toolErrorsCount = 0

    const hasTools = Object.keys(tools).length > 0
    const hasKnowledgeBase = "search_knowledge_base" in tools
    const result = await streamText({
      model,
      system: systemPrompt,
      messages,
      maxOutputTokens: aiAgent.maxOutputTokens,
      temperature: aiAgent.temperature,
      tools,
      toolChoice: hasTools ? "auto" : "none",
      prepareStep: hasKnowledgeBase
        ? ({ stepNumber }) =>
            stepNumber === 0
              ? {
                  activeTools: ["search_knowledge_base"],
                  toolChoice: {
                    type: "tool",
                    toolName: "search_knowledge_base",
                  },
                }
              : undefined
        : undefined,
      stopWhen: stepCountIs(5),
      timeout: {
        totalMs: aiTimeouts.aiTotal,
        stepMs: aiTimeouts.aiStep,
        chunkMs: aiTimeouts.aiChunk,
      },
      onStepFinish: ({
        stepNumber,
        finishReason,
        rawFinishReason,
        toolCalls,
        toolResults,
      }) => {
        stepCount = Math.max(stepCount, stepNumber + 1)
        finishReasons.push({
          stepNumber,
          finishReason,
          rawFinishReason,
        })

        toolCallsCount += toolCalls.length
        for (const call of toolCalls) {
          if (call?.toolName) {
            toolNamesSet.add(call.toolName)
            if (call.toolName === systemFunctionNames.webSearch) {
              webSearchesCount += 1
            }
          }
        }

        toolResultsCount += toolResults.length
        for (const tr of toolResults) {
          if (hasToolResultError(tr)) {
            toolErrorsCount += 1
          }
        }
      },
      experimental_onToolCallFinish: ({
        toolCall,
        durationMs,
        success,
        error,
      }) => {
        if (!success) {
          const normalizedError = normalizeError(error)
          logger.warn(
            {
              provider,
              modelId: selectedModelId,
              conversationId: conversation.id,
              workspaceId: conversation.workspaceId,
              toolName: toolCall?.toolName,
              toolCallId: toolCall?.toolCallId,
              durationMs,
              error: normalizedError,
              errorMessage: normalizedError.message,
            },
            "[ai-agent-runner] tool execution failed",
          )
        }
      },
      abortSignal,
      // The SDK does not throw provider failures out of streamText — it emits
      // them into the stream and hands them here. Without this the stream just
      // ends with zero steps: the customer gets silence, and the only trace is
      // `result.totalUsage` rejecting with NoOutputGeneratedError inside the
      // billing block below, which logs it as a settlement warning. A total
      // reply failure was being reported as a billing hiccup. Rethrow so it
      // reaches the catch that releases the reservation and logs the real
      // provider error, matching what generate-text already does.
      onError: ({ error }) => {
        throw error
      },
    })

    const { fullText } = await processStreamingText(
      result.textStream,
      async () => {
        // noop: fullText is accumulated internally, no message to send
      },
      { sendParts: false },
    ).catch((streamError) => {
      const normalizedError = normalizeError(streamError)
      logger.error(
        {
          err: normalizedError,
          provider,
          modelId: selectedModelId,
          conversationId: conversation.id,
        },
        "[ai-agent-runner] processStreamingText threw error",
      )
      return { fullText: "" }
    })

    // Points billing, centralized here: every real AI call that reaches this
    // point (reply text or tool-only fallback) goes through the same debit,
    // so no call site can forget to bill and no path can double-bill. Never
    // lets a billing failure break a reply that already succeeded — the
    // merchant's customer still gets their answer, and the miss is logged
    // for reconciliation instead of surfacing as a user-facing error.
    try {
      const usage = await result.totalUsage
      await usageMeteringService.settleLanguage(reservation, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens,
        webSearches: webSearchesCount,
      })
    } catch (settleError) {
      // `result.totalUsage` rejects with NoOutputGeneratedError when the model
      // produced no steps at all. That is a REPLY failure, not a billing one:
      // the customer got silence. Logging it as a settlement warning is what
      // kept this invisible — report it for what it is, at error level, so it
      // shows up in an outage search instead of a billing one.
      const normalizedError = normalizeError(settleError)
      const producedNoOutput = normalizedError.message.includes(
        "No output generated",
      )
      const context = {
        err: normalizedError,
        provider,
        modelId: selectedModelId,
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        operationId: reservation?.operationId,
      }

      if (producedNoOutput) {
        logger.error(
          context,
          "[ai-agent-runner] model returned no output — customer received no reply",
        )
      } else {
        logger.warn(
          context,
          "[ai-agent-runner] usage settlement failed after a successful AI reply",
        )
      }
    }

    if (fullText) {
      await aiContextService.appendHistory({
        conversationId: conversation.id,
        newMessages: [
          {
            message: {
              role: "assistant",
              content: fullText,
            },
            createdAt: Date.now(),
          },
        ],
      })

      return {
        responded: true,
        provider,
        modelId: selectedModelId,
        usedFallbackText: false,
        fullText,
        toolStats: {
          steps: stepCount,
          toolCallsCount,
          toolResultsCount,
          toolErrorsCount,
          toolNames: Array.from(toolNamesSet).slice(0, 10),
          finishReasons: finishReasons.slice(0, 10),
        },
      }
    }

    if (toolCallsCount > 0 || toolResultsCount > 0) {
      return {
        responded: true,
        provider,
        modelId: selectedModelId,
        usedFallbackText: true,
        fullText: helpTexts.fallbackLookup,
        toolStats: {
          steps: stepCount,
          toolCallsCount,
          toolResultsCount,
          toolErrorsCount,
          toolNames: Array.from(toolNamesSet).slice(0, 10),
          finishReasons: finishReasons.slice(0, 10),
        },
      }
    }

    return null
  } catch (error) {
    if (reservation) {
      await usageMeteringService
        .release(reservation, error)
        .catch((releaseError) => {
          logger.error(
            {
              err: normalizeError(releaseError),
              operationId: reservation?.operationId,
            },
            "[ai-agent-runner] failed to release usage reservation",
          )
        })
    }
    const normalizedError = normalizeError(error)
    logger.error(
      {
        err: normalizedError,
        provider,
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
      },
      "[ai-agent-runner] runAIReplyInternal failed",
    )
    return null
  }
}

async function createAgentModel(props: {
  conversationId: string
  providerInfo: AIAgentModelConfig
  workspaceId: string
}) {
  const { conversationId, providerInfo, workspaceId } = props

  if (isOpenaiCompatibleProviderModel(providerInfo)) {
    const integration =
      await integrationOpenaiCompatibleService.findByWorkspaceIdAndId({
        workspaceId,
        id: providerInfo.integrationId,
      })

    if (!integration?.enabled) {
      return null
    }

    return createOpenaiCompatibleModelInstance({
      integration,
      modelId: providerInfo.model,
    })
  }

  const integration = await aiIntegrationService.findBy({
    workspaceId,
    provider: providerInfo.provider,
  })

  if (!integration) {
    return null
  }

  return createAIModelInstance({
    model: integration,
    provider: providerInfo.provider,
    modelId: providerInfo.model,
    traceId: conversationId,
  })
}

function isNativeProviderModel(
  providerInfo: AIAgentModelConfig,
): providerInfo is AIAgentProviderModel {
  return "provider" in providerInfo
}

function isOpenaiCompatibleProviderModel(
  providerInfo: AIAgentModelConfig,
): providerInfo is AIAgentOpenaiCompatibleProviderModel {
  return "kind" in providerInfo && providerInfo.kind === "openaiCompatible"
}

function getProviderName(providerInfo: AIAgentModelConfig) {
  return isOpenaiCompatibleProviderModel(providerInfo)
    ? "openaiCompatible"
    : providerInfo.provider
}

function hasToolResultError(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false
  }

  if (!("isError" in value)) {
    return false
  }

  return Boolean(value.isError)
}
