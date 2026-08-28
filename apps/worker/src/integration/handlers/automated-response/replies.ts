import {
  aiProviders,
  aiTimeouts,
  helpTexts,
  processStreamingText,
  systemFunctionNames,
  toolPrefixes,
} from "@chatbotx.io/ai"
import {
  type AIProviderInstance,
  aiContextService,
  appendFabricationGuard,
  appendHandoffPolicy,
  appendKnowledgeBaseGuard,
  appendToolOutputGuard,
  buildPlatformOverrideCandidates,
  createAIProviderInstance,
  createOpenaiCompatibleModelInstance,
  getActivePlatformAiOverride,
  getAIIntegrationInDB,
  getAIToolset,
  getPlatformAzureOpenAIChatModel,
  getPlatformAzureOpenAIProvider,
  getPlatformCapabilityLanguageModel,
  getPlatformVertexChatModel,
  getPlatformVertexProvider,
  isPlatformAzureOpenAIModelCandidate,
  isPlatformVertexModelCandidate,
  McpClient,
  normalizeAuthorizedWebSearchDomains,
  normalizeMcpContent,
  type PlatformModelCandidate,
} from "@chatbotx.io/ai/server"
import {
  integrationOpenaiCompatibleService,
  type UsageReservation,
  usageMeteringService,
  userQuotaService,
} from "@chatbotx.io/business"
import type {
  AIAgentModelConfig,
  AIAgentOpenaiCompatibleProviderModel,
  AIAgentProvider,
  AIAgentProviderModels,
  DefaultReplyFrequency,
} from "@chatbotx.io/database/partials"
import type {
  AIAgentModel,
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { webhookChannelOrigin } from "@chatbotx.io/events/context"
import { contactVariableService } from "@chatbotx.io/variables"
import {
  type BotResponseTrackingContext,
  IntegrationJobAction,
  integrationQueue,
} from "@chatbotx.io/worker-config"
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai"
import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../lib/logger"
import { handoffExecutorService } from "../../../trigger/services/handoff-executor.service"
import { sendMessageAndWait, sendMessageWithRender } from "../../utils/message"
import { logProviderAttempt } from "../shared/provider-attempt-logger"
import { reserveUsageOrUnmetered } from "../shared/reserve-usage"
import { triggerDefaultReplyFlow } from "./default-reply"
import { handleRichAIReply } from "./rich-reply"
import { createDocumentReaderExecutor } from "./system-tools/document-reader"
import { createImageReaderExecutor } from "./system-tools/image-reader"
import { createUrlReaderExecutor } from "./system-tools/url-reader"
import {
  buildTrackingContext,
  consumeTrackingContext,
  type TrackingContextRef,
} from "./tracking-context"

export type ReplyByAIProps = {
  conversation: ConversationModel
  contactInbox: ContactInboxModel
  channel?: string
  messages: ModelMessage[]
  aiAgent: AIAgentModel
  triggerMessageId?: string
  fileOnlyTrigger: boolean
  allowedSystemFunctionIds?: string[]
  summary?: string
  defaultReplyFlowId?: string | null
  workspaceLanguage?: string
  defaultReplyFrequency: DefaultReplyFrequency
}

export type ReplyByAIExecutionResult = {
  responded: boolean
  provider: ReplyAIProvider
  modelId: string
  usedFallbackText: boolean
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

export type ReplyAIProvider =
  | AIAgentProvider
  | "vertex"
  | "azureOpenAI"
  | "openaiCompatible"

/** Tool id the knowledge-base search is registered under. */
const KNOWLEDGE_SEARCH_TOOL = "search_knowledge_base"

/**
 * Total steps one reply may take, mirroring `stopWhen: stepCountIs(...)` below.
 * Named so `prepareStep` can reserve the final step for writing the answer
 * instead of hardcoding the same number in two places.
 */
const MAX_REPLY_STEPS = 5

/**
 * Searches allowed per reply. Step 0 is already forced into one, so this leaves
 * room for a single follow-up search when the first query missed — and stops
 * there, because past that the model was not gathering information, it was
 * looping.
 */
const MAX_KNOWLEDGE_SEARCHES = 2

function getNoResponseFallback(language?: string): string {
  if (language?.toLowerCase().startsWith("ar")) {
    return "عذرًا، لم أتمكن من إنشاء رد كامل الآن. يرجى إعادة صياغة طلبك أو تحديد ما تحتاجه وسأساعدك."
  }
  return helpTexts.fallbackLookup
}

/**
 * Vertex rejects a generation request whose final conversation turn is from
 * the model. This can happen when a queued webhook is retried after the
 * preceding assistant reply was persisted, but before a new user message was
 * added to the AI context. Remove only those dangling assistant turns; all
 * customer turns and complete tool exchanges remain intact.
 */
function removeTrailingAssistantTurns(messages: ModelMessage[]): {
  messages: ModelMessage[]
  removed: number
} {
  const normalized = [...messages]
  let removed = 0
  while (normalized.at(-1)?.role === "assistant") {
    normalized.pop()
    removed += 1
  }
  return { messages: normalized, removed }
}

export async function replyByAI(
  props: ReplyByAIProps,
): Promise<null | ReplyByAIExecutionResult> {
  const { aiAgent, conversation } = props
  if (
    !(await userQuotaService.isAutoReplyEnabledForWorkspace(
      aiAgent.workspaceId,
    ))
  ) {
    logger.info(
      { workspaceId: aiAgent.workspaceId, aiAgentId: aiAgent.id },
      "[automated-response] skipped because the current plan disables auto reply",
    )
    return null
  }

  // Platform-locked Vertex setting takes precedence over the agent's own
  // stored fallback chain. Its synthetic candidates end with Azure OpenAI.
  // `null` means disabled, so this behaves exactly as before this setting existed.
  const platformOverride = await getActivePlatformAiOverride()
  const providers: (AIAgentModelConfig | PlatformModelCandidate)[] =
    platformOverride
      ? buildPlatformOverrideCandidates(platformOverride)
      : (aiAgent.models as AIAgentProviderModels)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)

  try {
    for (const [index, providerInfo] of providers.entries()) {
      const attemptStartedAt = Date.now()
      const result = await runAIReply(props, providerInfo, controller.signal)
      const durationMs = Date.now() - attemptStartedAt
      // A `null` result can also mean the provider was intentionally skipped
      // (not configured / auto-reply off) or an empty completion / error —
      // those are already logged at the right level inside
      // runAIReply/createReplyModel, so this summary log shouldn't re-flag
      // them as warnings.
      logProviderAttempt(
        logger,
        durationMs,
        {
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
          agentId: aiAgent.id,
          provider: getProviderName(providerInfo),
          providerIndex: index,
          providerCount: providers.length,
          durationMs,
          responded: Boolean(result?.responded),
        },
        "[automated-response] fallback chain provider attempt",
      )
      if (result?.responded) {
        return result
      }
    }
  } finally {
    clearTimeout(timeoutId)
  }

  // A configured agent must never leave the customer without any response.
  // Every candidate has already run in order (Vertex first, then Azure), so
  // this is an explicit, localized clarification rather than silent failure.
  const primaryCandidate = providers[0]
  const provider = primaryCandidate
    ? getProviderName(primaryCandidate)
    : "vertex"
  const modelId = primaryCandidate?.model ?? "unavailable-response"
  logger.warn(
    {
      conversationId: props.conversation.id,
      workspaceId: props.conversation.workspaceId,
      agentId: aiAgent.id,
      provider,
      modelId,
      candidatesTried: providers.length,
      providers: providers.map((p) => getProviderName(p)),
    },
    "[automated-response] all AI candidates completed without a response; sending localized fallback",
  )
  await sendMessageWithRender(
    props.conversation.id,
    getNoResponseFallback(
      (props.workspaceLanguage ?? props.contactInbox.language) ?? undefined,
    ),
  )
  return {
    responded: true,
    provider,
    modelId,
    usedFallbackText: true,
    toolStats: {
      steps: 0,
      toolCallsCount: 0,
      toolResultsCount: 0,
      toolErrorsCount: 0,
      toolNames: [],
      finishReasons: [],
    },
  }
}

export type GenerateAIReplyProps = {
  conversation: ConversationModel
  contactInbox: ContactInboxModel
  messages: ModelMessage[]
  aiAgent: AIAgentModel
  operationId: string
}

export type GeneratedAIReply = {
  text: string
  provider: ReplyAIProvider
  modelId: string
}

/**
 * Generate an AI agent reply as plain text WITHOUT sending it anywhere.
 *
 * Unlike `replyByAI`, this runs the provider-fallback loop with tools and rich
 * mode disabled and returns the accumulated text, so the caller controls the
 * delivery channel (e.g. a public Facebook comment reply vs a private DM). Tools
 * are off so nothing can send out-of-band (the `sendMessage`/`triggerFlow`/
 * handoff system tools all send DMs on their own). It mirrors the DM policy by
 * only using auto-reply-enabled provider integrations.
 */
export async function generateAIReplyText(
  props: GenerateAIReplyProps,
): Promise<GeneratedAIReply | null> {
  const { conversation, contactInbox, messages, aiAgent } = props
  if (
    !(await userQuotaService.isAutoReplyEnabledForWorkspace(
      aiAgent.workspaceId,
    ))
  ) {
    return null
  }

  const platformOverride = await getActivePlatformAiOverride()
  const providers: (AIAgentModelConfig | PlatformModelCandidate)[] =
    platformOverride
      ? buildPlatformOverrideCandidates(platformOverride)
      : (aiAgent.models as AIAgentProviderModels)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)
  let activeReservation: UsageReservation | undefined

  try {
    const variables = await contactVariableService.getAll({
      contactId: conversation.contactId,
      contactInbox,
      conversation,
    })
    const systemPrompt = aiAgent.prompt
      ? await contactVariableService.replaceAll({
          text: aiAgent.prompt,
          variables,
        })
      : ""

    const { messages: modelMessages } = removeTrailingAssistantTurns(messages)

    for (const providerInfo of providers) {
      const modelConfig = await createReplyModel({
        workspaceId: conversation.workspaceId,
        providerInfo,
      })
      if (!modelConfig) {
        continue
      }
      const provider = getProviderName(providerInfo)

      activeReservation = await reserveUsageOrUnmetered(
        {
          workspaceId: conversation.workspaceId,
          operationId: `${props.operationId}:${provider}:${providerInfo.model}`,
          category: "language",
          provider,
          model: providerInfo.model,
          metadata: { conversationId: conversation.id, aiAgentId: aiAgent.id },
        },
        {
          provider,
          modelId: providerInfo.model,
          conversationId: conversation.id,
        },
      )

      const result = await streamText({
        model: modelConfig.model,
        system: systemPrompt,
        messages: modelMessages,
        maxOutputTokens: aiAgent.maxOutputTokens,
        temperature: aiAgent.temperature,
        tools: {},
        toolChoice: "none",
        stopWhen: stepCountIs(1),
        timeout: {
          totalMs: aiTimeouts.aiTotal,
          stepMs: aiTimeouts.aiStep,
          chunkMs: aiTimeouts.aiChunk,
        },
        abortSignal: controller.signal,
        // Provider failures are emitted into the stream, not thrown. Rethrow
        // so they surface as real errors instead of an empty reply.
        onError: ({ error }) => {
          throw error
        },
      })

      const { fullText } = await processStreamingText(
        result.textStream,
        async () => {
          // generate-only: never send
        },
        { sendParts: false },
      ).catch((streamError) => {
        logger.error(
          {
            provider,
            modelId: providerInfo.model,
            conversationId: conversation.id,
            error: normalizeError(streamError),
          },
          "[comment-ai-reply] processStreamingText threw error",
        )
        return { fullText: "" }
      })

      const text = fullText.trim()
      try {
        // Awaited even without a reservation: `totalUsage` rejecting is how a
        // total reply failure surfaces, and that signal must not disappear
        // just because metering was skipped.
        const usage = await result.totalUsage
        if (activeReservation) {
          await usageMeteringService.settleLanguage(activeReservation, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
            reasoningTokens: usage.outputTokenDetails.reasoningTokens,
          })
        }
      } catch (settleError) {
        logger.warn(
          {
            err: normalizeError(settleError),
            provider,
            conversationId: conversation.id,
            operationId: activeReservation?.operationId,
          },
          "[comment-ai-reply] usage settlement failed after a successful AI reply",
        )
      }
      activeReservation = undefined
      if (text) {
        return {
          text,
          provider,
          modelId: providerInfo.model,
        }
      }
    }

    return null
  } catch (error) {
    if (activeReservation) {
      await usageMeteringService.release(activeReservation, error)
    }
    logger.error(
      { err: normalizeError(error), operationId: props.operationId },
      "[comment-ai-reply] generation failed",
    )
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function createReplyToolset(options: {
  abortSignal: AbortSignal
  directSendTracker: { sent: boolean; sentText: string }
  model: LanguageModel
  modelId: string
  props: ReplyByAIProps
  provider: ReplyAIProvider
  providerInstance?: AIProviderInstance
  trackingContextRef: TrackingContextRef
}) {
  const { conversation, aiAgent } = options.props
  const tools = filterToolsByAllowedSystemFunctions(
    aiAgent.tools,
    options.props.allowedSystemFunctionIds,
  )
  const webSearchToolValue = `${toolPrefixes.enum.sys}:${systemFunctionNames.webSearch}`
  const hasWebSearchTool = tools.includes(webSearchToolValue)
  const toolsetTools = hasWebSearchTool
    ? tools.filter((tool) => tool !== webSearchToolValue)
    : tools
  let nativeWebSearchTool: { omitReason?: string; tool?: ToolSet[string] } = {
    omitReason: undefined,
    tool: undefined,
  }

  if (hasWebSearchTool) {
    nativeWebSearchTool = options.providerInstance
      ? createNativeWebSearchTool({
          aiAgent,
          conversation,
          modelId: options.modelId,
          provider: options.provider,
          providerInstance: options.providerInstance,
        })
      : { omitReason: "provider_not_supported", tool: undefined }
  }

  return getAIToolset({
    workspaceId: aiAgent.workspaceId,
    tools: toolsetTools,
    toolPrefixes: {
      file: toolPrefixes.enum.file,
      fn: toolPrefixes.enum.fn,
      mcp: toolPrefixes.enum.mcp,
      sys: toolPrefixes.enum.sys,
    },
    systemFunctionContextGetter: async () => ({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      sendMessage: async (text: string) => {
        options.directSendTracker.sent = true
        options.directSendTracker.sentText = text
        if (text) {
          await sendMessageAndWait(
            conversation.id,
            text,
            consumeTrackingContext(options.trackingContextRef),
          )
        }
      },
      triggerFlow: async (flowId: string) => {
        await integrationQueue.add(IntegrationJobAction.sendFlow, {
          type: IntegrationJobAction.sendFlow,
          data: {
            conversationId: conversation.id,
            contactInboxId: options.props.contactInbox.id,
            flowId,
            origin: webhookChannelOrigin(),
          },
        })
      },
    }),
    systemToolExecutors: {
      [systemFunctionNames.connectUserToHuman]: async (args, context) => {
        if (!context) {
          return "I'm ready to connect you to a human agent, but conversation context is missing."
        }

        await handoffExecutorService.execute({
          workspaceId: context.workspaceId,
          conversationId: context.conversationId,
          contactId: context.contactId,
          reason: args.reason,
          source: "ai_system_tool",
          channel: context.channel,
          metadata: {
            userRequestExcerpt: args.userRequestExcerpt,
            requestedBy: args.requestedBy,
          },
        })

        return "I'm connecting you to a human agent who can better assist you. Please stay on the line."
      },
      [systemFunctionNames.documentReader]: createDocumentReaderExecutor({
        fileOnlyTrigger: options.props.fileOnlyTrigger,
        triggerMessageId: options.props.triggerMessageId,
      }),
      [systemFunctionNames.imageReader]: createImageReaderExecutor({
        abortSignal: options.abortSignal,
        fileOnlyTrigger: options.props.fileOnlyTrigger,
        language:
          (options.props.workspaceLanguage ??
            options.props.contactInbox.language) ??
          undefined,
        model: options.model,
        modelId: options.modelId,
        provider: options.provider,
        triggerMessageId: options.props.triggerMessageId,
      }),
      [systemFunctionNames.urlContext]: createUrlReaderExecutor({
        fileOnlyTrigger: options.props.fileOnlyTrigger,
        triggerMessageId: options.props.triggerMessageId,
      }),
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
  }).then((toolset) => ({
    cleanup: toolset.cleanup,
    tools: {
      ...toolset.tools,
      ...(nativeWebSearchTool.tool
        ? { [systemFunctionNames.webSearch]: nativeWebSearchTool.tool }
        : {}),
    },
    webSearchOmitReason: nativeWebSearchTool.omitReason,
  }))
}

// gpt-4o-mini and its variants reject the `filters` param at the API level
const OPENAI_MODELS_WITHOUT_SEARCH_FILTER = new Set([
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4o-mini-search-preview",
  "gpt-4o-mini-search-preview-2025-03-11",
])

function openAIModelSupportsWebSearchFilter(modelId: string): boolean {
  return !OPENAI_MODELS_WITHOUT_SEARCH_FILTER.has(modelId)
}

function createNativeWebSearchTool(options: {
  aiAgent: AIAgentModel
  conversation: ConversationModel
  modelId: string
  provider: string
  providerInstance: AIProviderInstance
}): { omitReason?: string; tool?: ToolSet[string] } {
  const rawDomains = options.aiAgent.webSearchAuthorizedDomains
  const authorizedDomains = normalizeAuthorizedWebSearchDomains(rawDomains)
  const authorizedDomainsCount = authorizedDomains.length

  logger.info(
    {
      provider: options.provider,
      modelId: options.modelId,
      conversationId: options.conversation.id,
      workspaceId: options.conversation.workspaceId,
      rawDomains,
      authorizedDomains,
      authorizedDomainsCount,
      hasProviderTools: "tools" in options.providerInstance,
    },
    "[automated-response] createNativeWebSearchTool: domain filter check",
  )

  if (options.provider === aiProviders.enum.openai) {
    if (!("tools" in options.providerInstance)) {
      logWebSearchOmit({
        authorizedDomainsCount,
        conversationId: options.conversation.id,
        modelId: options.modelId,
        provider: options.provider,
        reason: "provider_web_search_not_supported",
        workspaceId: options.conversation.workspaceId,
      })

      return { omitReason: "provider_not_supported" }
    }

    const modelSupportsDomainFilter = openAIModelSupportsWebSearchFilter(
      options.modelId,
    )

    if (authorizedDomains.length > 0 && !modelSupportsDomainFilter) {
      logWebSearchOmit({
        authorizedDomainsCount,
        conversationId: options.conversation.id,
        modelId: options.modelId,
        provider: options.provider,
        reason: "model_domain_filter_not_supported",
        workspaceId: options.conversation.workspaceId,
      })

      return { omitReason: "model_domain_filter_not_supported" }
    }

    const providerTools = options.providerInstance.tools

    if ("webSearch" in providerTools) {
      const filters =
        authorizedDomains.length > 0 && modelSupportsDomainFilter
          ? { allowedDomains: authorizedDomains }
          : undefined

      logger.info(
        {
          provider: options.provider,
          modelId: options.modelId,
          conversationId: options.conversation.id,
          workspaceId: options.conversation.workspaceId,
          filtersApplied: !!filters,
          allowedDomains: filters?.allowedDomains ?? [],
          modelSupportsDomainFilter,
        },
        "[automated-response] createNativeWebSearchTool: openai webSearch tool created",
      )

      return {
        tool: providerTools.webSearch({
          externalWebAccess: true,
          filters,
          searchContextSize: "medium",
        }) as ToolSet[string],
      }
    }
  }

  if (
    options.provider === aiProviders.enum.gemini ||
    options.provider === "vertex"
  ) {
    if (authorizedDomains.length > 0) {
      logWebSearchOmit({
        authorizedDomainsCount,
        conversationId: options.conversation.id,
        modelId: options.modelId,
        provider: options.provider,
        reason: "gemini_domain_allowlist_not_supported",
        workspaceId: options.conversation.workspaceId,
      })

      return { omitReason: "domain_allowlist_not_supported" }
    }

    if (!("tools" in options.providerInstance)) {
      logWebSearchOmit({
        authorizedDomainsCount,
        conversationId: options.conversation.id,
        modelId: options.modelId,
        provider: options.provider,
        reason: "provider_web_search_not_supported",
        workspaceId: options.conversation.workspaceId,
      })

      return { omitReason: "provider_not_supported" }
    }

    const providerTools = options.providerInstance.tools

    if ("googleSearch" in providerTools) {
      logger.info(
        {
          provider: options.provider,
          modelId: options.modelId,
          conversationId: options.conversation.id,
          workspaceId: options.conversation.workspaceId,
        },
        "[automated-response] createNativeWebSearchTool: gemini googleSearch tool created (no domain filter)",
      )

      return {
        tool: providerTools.googleSearch({}) as ToolSet[string],
      }
    }
  }

  logWebSearchOmit({
    authorizedDomainsCount,
    conversationId: options.conversation.id,
    modelId: options.modelId,
    provider: options.provider,
    reason: "provider_web_search_not_supported",
    workspaceId: options.conversation.workspaceId,
  })

  return { omitReason: "provider_not_supported" }
}

function logWebSearchOmit(input: {
  authorizedDomainsCount: number
  conversationId: string
  modelId: string
  provider: string
  reason: string
  workspaceId: string
}) {
  logger.warn(
    {
      authorizedDomainsCount: input.authorizedDomainsCount,
      conversationId: input.conversationId,
      modelId: input.modelId,
      provider: input.provider,
      reason: input.reason,
      toolName: systemFunctionNames.webSearch,
      workspaceId: input.workspaceId,
    },
    "[automated-response] web search tool omitted",
  )
}

function filterToolsByAllowedSystemFunctions(
  tools: string[],
  allowedSystemFunctionIds?: string[],
): string[] {
  if (!allowedSystemFunctionIds) {
    return tools
  }

  // The one caller (index.ts, isFileOnlyTrigger) passes this to force a
  // single reader tool for a turn that is only "the user sent a file, nothing
  // else" — e.g. only image_reader when an image arrived with no text.
  // Non-"sys:" tools (file:<id> knowledge-base search, fn:, mcp:) used to pass
  // through unfiltered, so the model still had file_search sitting right next
  // to image_reader and could reach for the wrong one — observed live: an
  // image-only WhatsApp message made the agent query the knowledge base for
  // "wesal onboarding image" instead of analyzing the photo, and reply with
  // unrelated platform text. A restricted turn now means restricted to
  // exactly the requested system function, full stop.
  const allowedSystemFunctionIdSet = new Set(allowedSystemFunctionIds)
  const systemToolPrefix = `${toolPrefixes.enum.sys}:`

  return tools.filter((tool) => {
    if (!tool.startsWith(systemToolPrefix)) {
      return false
    }

    const systemFunctionId = tool.slice(systemToolPrefix.length)
    return allowedSystemFunctionIdSet.has(systemFunctionId)
  })
}

function isOpenaiCompatibleProviderModel(
  providerInfo: AIAgentModelConfig | PlatformModelCandidate,
): providerInfo is AIAgentOpenaiCompatibleProviderModel {
  return "kind" in providerInfo && providerInfo.kind === "openaiCompatible"
}

function getProviderName(
  providerInfo: AIAgentModelConfig | PlatformModelCandidate,
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

async function createReplyModel(props: {
  providerInfo: AIAgentModelConfig | PlatformModelCandidate
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

async function runAIReply(
  props: ReplyByAIProps,
  providerInfo: AIAgentModelConfig | PlatformModelCandidate,
  abortSignal: AbortSignal,
): Promise<null | ReplyByAIExecutionResult> {
  const { conversation, messages, aiAgent } = props
  const provider = getProviderName(providerInfo)
  let cleanup: (() => Promise<void>) | undefined
  let reservation: UsageReservation | undefined

  try {
    const selectedModelId = providerInfo.model
    const modelConfig = await createReplyModel({
      workspaceId: conversation.workspaceId,
      providerInfo,
    })

    if (!modelConfig) {
      return null
    }

    reservation = await reserveUsageOrUnmetered(
      {
        workspaceId: conversation.workspaceId,
        operationId: `auto-reply:${props.triggerMessageId ?? conversation.updatedAt.toISOString()}:${provider}:${selectedModelId}`,
        category: "language",
        provider,
        model: selectedModelId,
        metadata: { conversationId: conversation.id, aiAgentId: aiAgent.id },
      },
      {
        provider,
        modelId: selectedModelId,
        conversationId: conversation.id,
      },
    )

    const startTime = Date.now()

    const successTrackingContext: BotResponseTrackingContext | undefined =
      props.triggerMessageId
        ? buildTrackingContext({
            conversationId: conversation.id,
            messageId: props.triggerMessageId,
            provider,
            responseType: "ai_agent",
            startTime,
            triggerType: "bot_response_ai_agent_success",
            workspaceId: conversation.workspaceId,
          })
        : undefined
    // Shared across the `sendMessage` tool (which the model may invoke more
    // than once in a multi-step tool loop) and the plain-text streaming
    // reply below, so tracking attaches to exactly one outbound message per
    // run no matter which path sends it first.
    const trackingContextRef: TrackingContextRef = {
      current: successTrackingContext,
    }
    const directSendTracker = { sent: false, sentText: "" }
    const visionModel = await getPlatformCapabilityLanguageModel("vision")
    const toolset = await createReplyToolset({
      abortSignal,
      directSendTracker,
      model: visionModel ?? modelConfig.model,
      modelId: selectedModelId,
      props,
      provider,
      providerInstance: modelConfig.providerInstance,
      trackingContextRef,
    })
    const tools = toolset.tools
    cleanup = toolset.cleanup

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

    const richModeEnabled =
      aiAgent.isRichResponse && Boolean(props.triggerMessageId)
    if (aiAgent.isRichResponse && !props.triggerMessageId) {
      logger.warn(
        {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          reason: "missing_rich_response_execution_id",
        },
        "[rich-response] rich mode disabled for AI reply",
      )
    }

    const guardedPrompt = appendUnavailableWebSearchPolicy(
      appendHandoffPolicy(
        appendKnowledgeBaseGuard(
          appendFabricationGuard(appendToolOutputGuard(completePrompt), tools),
          tools,
        ),
        tools,
      ),
      toolset.webSearchOmitReason,
    )
    const systemPrompt = richModeEnabled
      ? appendRichResponseFormat(guardedPrompt)
      : guardedPrompt

    const toolNamesSet = new Set<string>()
    /**
     * How many times the model has searched the knowledge base this turn.
     *
     * `stepCountIs(5)` is the whole budget, and step 0 is forced into a search.
     * With nothing stopping it the model keeps searching — observed on
     * production: six searches in fifteen seconds, three of them with an empty
     * query returning nothing — until the budget is gone, no text is ever
     * produced, and the customer gets "لم أتمكن من إنشاء رد كامل الآن".
     * Fifteen customers hit that in one day.
     */
    let knowledgeSearchCount = 0
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

    const runtimeTools: ToolSet = tools
    const hasTools = Object.keys(runtimeTools).length > 0
    const hasKnowledgeBase = KNOWLEDGE_SEARCH_TOOL in runtimeTools
    const { messages: modelMessages, removed: removedAssistantTurns } =
      removeTrailingAssistantTurns(messages)
    if (removedAssistantTurns > 0) {
      logger.warn(
        {
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
          provider,
          modelId: selectedModelId,
          removedAssistantTurns,
        },
        "[automated-response] removed dangling assistant turns before model request",
      )
    }
    const result = await streamText({
      model: modelConfig.model,
      system: systemPrompt,
      messages: modelMessages,
      maxOutputTokens: aiAgent.maxOutputTokens,
      temperature: aiAgent.temperature,
      tools: runtimeTools,
      toolChoice: hasTools ? "auto" : "none",
      prepareStep: ({ stepNumber }) => {
        if (stepNumber === 0 && hasKnowledgeBase) {
          return {
            activeTools: [KNOWLEDGE_SEARCH_TOOL],
            toolChoice: {
              type: "tool",
              toolName: KNOWLEDGE_SEARCH_TOOL,
            },
          }
        }
        // Image analysis is an information-gathering step. Once it has run,
        // require the next step to turn that result into the customer-facing
        // answer instead of letting the model spend the remaining step budget
        // repeating tools and falling through to the generic reply.
        if (toolNamesSet.has(systemFunctionNames.imageReader)) {
          return { activeTools: [], toolChoice: "none" }
        }
        // The last step has to produce the answer. Leaving tools available here
        // lets the model spend it on one more call and finish with no text at
        // all, which is the single largest source of the generic fallback
        // reaching customers.
        if (stepNumber >= MAX_REPLY_STEPS - 1) {
          return { activeTools: [], toolChoice: "none" }
        }
        // Searching the knowledge base is the same kind of information-
        // gathering step as reading an image, and the model treats it as the
        // one tool guaranteed to work — so it repeats it until the budget is
        // gone. Two searches is enough to answer from; after that it must write.
        if (knowledgeSearchCount >= MAX_KNOWLEDGE_SEARCHES) {
          return { activeTools: [], toolChoice: "none" }
        }
        return undefined
      },
      stopWhen: stepCountIs(MAX_REPLY_STEPS),
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
            if (call.toolName === KNOWLEDGE_SEARCH_TOOL) {
              knowledgeSearchCount += 1
            }
            if (call.toolName === systemFunctionNames.webSearch) {
              webSearchesCount += 1
            }
          }
        }

        toolResultsCount += toolResults.length
        for (const toolResult of toolResults) {
          if (isToolResultError(toolResult)) {
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
            "[automated-response] tool execution failed",
          )
        }
      },
      abortSignal,
      // Provider failures are emitted into the stream, not thrown. Without
      // this the stream ends with zero steps and the customer gets silence,
      // while the only trace is a "usage settlement failed" warning — a reply
      // outage disguised as a billing problem.
      onError: ({ error }) => {
        throw error
      },
    })

    const buildToolStats = () => ({
      steps: stepCount,
      toolCallsCount,
      toolResultsCount,
      toolErrorsCount,
      toolNames: Array.from(toolNamesSet).slice(0, 10),
      finishReasons: finishReasons.slice(0, 10),
    })

    // Never let a settlement failure surface as a reply failure — by the
    // time this runs, several call sites have already sent (or handed off
    // rich actions for) the reply, so throwing here would make an
    // already-delivered reply look like it never happened and risk a
    // duplicate send from the caller's error handling.
    const settleUsage = async () => {
      try {
        // Awaited even without a reservation: `totalUsage` rejecting is how a
        // total reply failure surfaces, and that signal must not disappear
        // just because metering was skipped.
        const usage = await result.totalUsage
        if (reservation) {
          await usageMeteringService.settleLanguage(reservation, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
            reasoningTokens: usage.outputTokenDetails.reasoningTokens,
            webSearches: webSearchesCount,
          })
        }
      } catch (settleError) {
        logger.warn(
          {
            err: normalizeError(settleError),
            provider,
            conversationId: conversation.id,
            workspaceId: conversation.workspaceId,
            operationId: reservation?.operationId,
          },
          "[automated-response] usage settlement failed after a successful AI reply",
        )
      }
    }

    if (richModeEnabled) {
      const richResult = await handleRichAIReply({
        props,
        textStream: result.textStream,
        directSendTracker,
        provider,
        modelId: selectedModelId,
        startTime,
        buildToolStats,
      })
      await settleUsage()
      return richResult
    }

    const { messageCount, fullText } = await processStreamingText(
      result.textStream,
      async (_segment, parts) => {
        if (directSendTracker.sent) {
          return
        }
        for (const part of parts) {
          await sendMessageAndWait(
            conversation.id,
            part,
            consumeTrackingContext(trackingContextRef),
          )
        }
      },
      { sendParts: true },
    ).catch((streamError) => {
      const normalizedError = normalizeError(streamError)
      logger.error(
        {
          provider,
          modelId: selectedModelId,
          conversationId: conversation.id,
          error: normalizedError,
        },
        "[automated-response] processStreamingText threw error",
      )
      return { messageCount: 0, fullText: "" }
    })

    if (directSendTracker.sent) {
      await settleUsage()
      if (directSendTracker.sentText) {
        await aiContextService.appendHistory({
          conversationId: conversation.id,
          newMessages: [
            {
              message: {
                role: "assistant",
                content: directSendTracker.sentText,
              },
              createdAt: Date.now(),
            },
          ],
        })
      }
      return {
        responded: true,
        provider,
        modelId: selectedModelId,
        usedFallbackText: false,
        toolStats: buildToolStats(),
      }
    }

    if (messageCount > 0 && fullText) {
      await settleUsage()
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
        toolStats: buildToolStats(),
      }
    }

    // Last-resort fallback: loop finished but no assistant text was produced.
    // Do NOT leak raw tool outputs; prefer the workspace's configured default
    // reply flow, and only fall back to a clarifying question if none is set.
    if (toolCallsCount > 0 || toolResultsCount > 0) {
      await settleUsage()
      const defaultReplyResult = await triggerDefaultReplyFlow({
        workspaceId: conversation.workspaceId,
        defaultReplyFlowId: props.defaultReplyFlowId,
        defaultReplyFrequency: props.defaultReplyFrequency,
        conversation,
        contactInbox: props.contactInbox,
        trackingContext: props.triggerMessageId
          ? {
              aiProvider: provider,
              conversationId: conversation.id,
              messageId: props.triggerMessageId,
              responseType: "flow",
              startTime,
              triggerType: "bot_response_ai_agent_default_reply_flow",
              workspaceId: conversation.workspaceId,
            }
          : undefined,
      })
      // `skipped` (no flow configured / flow invalid) preserves the old
      // behavior: send the canned clarifying text. `throttled` means a valid
      // default reply flow exists but its activation window is still open for
      // this contact/channel — stay silent rather than double-message with a
      // canned line on top of a flow that already fired recently.
      if (defaultReplyResult === "skipped") {
        await sendMessageWithRender(
          conversation.id,
          getNoResponseFallback(
            (props.workspaceLanguage ?? props.contactInbox.language) ??
              undefined,
          ),
        )
      }
      return {
        responded: true,
        provider,
        modelId: selectedModelId,
        usedFallbackText: true,
        toolStats: buildToolStats(),
      }
    }

    await settleUsage()
    logger.warn(
      {
        provider,
        modelId: selectedModelId,
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        historyMessageCount: messages.length,
        hasSummary: Boolean(props.summary),
        ...buildToolStats(),
      },
      "[automated-response] AI produced an empty completion (no text, no tool calls)",
    )
    return null
  } catch (error) {
    if (reservation) {
      await usageMeteringService.release(reservation, error)
    }
    const normalizedError = normalizeError(error)
    logger.error(
      {
        error: normalizedError,
        provider,
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
      },
      "[automated-response] runAIReply failed",
    )
    return null
  } finally {
    try {
      await cleanup?.()
    } catch (cleanupError) {
      const normalizedError = normalizeError(cleanupError)
      logger.error(
        {
          error: normalizedError,
          provider,
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
        },
        "[automated-response] tool cleanup failed",
      )
    }
  }
}

function appendUnavailableWebSearchPolicy(
  systemPrompt: string,
  webSearchOmitReason?: string,
): string {
  if (!webSearchOmitReason) {
    return systemPrompt
  }

  return `${systemPrompt}\n\nWEB SEARCH AVAILABILITY (REQUIRED):\n- Web search is configured for this agent but is unavailable for the current provider or domain policy.\n- Do not claim that you searched, browsed, or looked up live web information.\n- Answer only from the conversation and available tools, or ask the user for clarification if live information is required.`.trim()
}

function appendRichResponseFormat(systemPrompt: string): string {
  return `${systemPrompt}\n\n${helpTexts.richResponseFormat}`.trim()
}

function isToolResultError(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("isError" in value)) {
    return false
  }

  return value.isError === true
}
