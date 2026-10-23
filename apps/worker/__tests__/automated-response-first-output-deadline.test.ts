import type {
  AIAgentModel,
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { type ModelMessage, streamText } from "ai"
import { beforeEach, describe, expect, test, vi } from "vitest"

// The deadline is read from the worker env when the reply runs; keep it short
// so a "silent" model is cut within the test's time budget.
vi.hoisted(() => {
  process.env.AI_REPLY_FIRST_OUTPUT_TIMEOUT_MS = "40"
})

type PlatformOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
}

const state = {
  platformOverride: {
    chatModel: "slow-model",
    fallbackModel: "fast-model",
    location: "global",
  } as PlatformOverride,
}

const sendMessageAndWaitMock = vi.hoisted(() => vi.fn(async () => undefined))
const usageMeteringReserveMock = vi.hoisted(() => vi.fn())
const usageMeteringSettleLanguageMock = vi.hoisted(() => vi.fn())
const usageMeteringReleaseMock = vi.hoisted(() => vi.fn())

function isPlatformVertexModelCandidateImpl(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformVertex?: unknown }).platformVertex === true
  )
}

vi.mock("@chatbotx.io/ai", () => ({
  aiProviders: { enum: { openai: "openai", gemini: "gemini" } },
  aiTimeouts: { aiTotal: 30_000, aiStep: 10_000, aiChunk: 5000 },
  helpTexts: { fallbackLookup: "fallback" },
  // Consumes the stream like the real helper: every text part is one message.
  processStreamingText: vi.fn(
    async (
      textStream: AsyncIterable<string>,
      onSegment: (segment: string, parts: string[]) => Promise<void>,
    ) => {
      let fullText = ""
      let messageCount = 0
      for await (const part of textStream) {
        fullText += part
        messageCount += 1
        await onSegment(part, [part])
      }
      return { fullText, messageCount }
    },
  ),
  systemFunctionNames: {
    webSearch: "webSearch",
    connectUserToHuman: "connectUserToHuman",
    documentReader: "documentReader",
    imageReader: "imageReader",
    urlReader: "urlReader",
  },
  toolPrefixes: { enum: { sys: "sys", file: "file", fn: "fn", mcp: "mcp" } },
  appendFabricationGuard: (p: string) => p,
  appendHandoffPolicy: (p: string) => p,
  appendKnowledgeBaseGuard: (p: string) => p,
  appendToolOutputGuard: (p: string) => p,
  appendUnavailableWebSearchPolicy: (p: string) => p,
}))

vi.mock("@chatbotx.io/ai/server", () => ({
  aiContextService: { appendHistory: vi.fn(async () => undefined) },
  appendAIAgentActionToolProtocol: (p: string) => p,
  appendFabricationGuard: (p: string) => p,
  appendHandoffPolicy: (p: string) => p,
  appendKnowledgeBaseGuard: (p: string) => p,
  appendToolOutputGuard: (p: string) => p,
  appendUnavailableWebSearchPolicy: (p: string) => p,
  buildPlatformOverrideCandidates: (override: PlatformOverride) => [
    { platformVertex: true, model: override.chatModel },
    ...(override.fallbackModel
      ? [{ platformVertex: true, model: override.fallbackModel }]
      : []),
  ],
  createAIProviderInstance: vi.fn(() => () => ({ type: "fake-model" })),
  createOpenaiCompatibleModelInstance: vi.fn(),
  getActivePlatformAiOverride: vi.fn(async () => state.platformOverride),
  getAIIntegrationInDB: vi.fn(),
  getAIToolset: vi.fn(async () => ({
    tools: {},
    cleanup: undefined,
    webSearchOmitReason: undefined,
  })),
  getPlatformCapabilityLanguageModel: vi.fn(async () => null),
  getPlatformAzureOpenAIChatModel: vi.fn(),
  getPlatformAzureOpenAIProvider: vi.fn(() =>
    Object.assign(vi.fn(), { tools: {} }),
  ),
  getPlatformVertexChatModel: vi.fn((modelId: string) => ({
    type: "vertex-model",
    modelId,
  })),
  getPlatformVertexProvider: vi.fn(() => Object.assign(vi.fn(), { tools: {} })),
  isPlatformAzureFoundryChatModel: () => false,
  isPlatformAzureOpenAIModelCandidate: () => false,
  isPlatformVertexModelCandidate: isPlatformVertexModelCandidateImpl,
  McpClient: vi.fn(),
  normalizeAuthorizedWebSearchDomains: vi.fn(() => []),
  normalizeMcpContent: vi.fn((c: unknown) => c),
}))

vi.mock("ai", () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn(() => () => false),
}))

vi.mock("../src/integration/utils/message", () => ({
  sendMessageAndWait: sendMessageAndWaitMock,
  sendMessageWithRender: vi.fn(async () => undefined),
}))

vi.mock("@chatbotx.io/variables", () => ({
  contactVariableService: {
    getAll: vi.fn(async () => []),
    replaceAll: vi.fn(async ({ text }: { text: string }) => text),
  },
}))

vi.mock("../src/trigger/services/handoff-executor.service", () => ({
  handoffExecutorService: { execute: vi.fn(async () => undefined) },
}))

vi.mock("@chatbotx.io/business", () => ({
  integrationOpenaiCompatibleService: { findByWorkspaceIdAndId: vi.fn() },
  userQuotaService: {
    isAutoReplyEnabledForWorkspace: vi.fn(async () => true),
  },
  usageMeteringService: {
    reserve: usageMeteringReserveMock,
    settleLanguage: usageMeteringSettleLanguageMock,
    release: usageMeteringReleaseMock,
  },
}))

vi.mock("@chatbotx.io/event-bus", () => ({
  emit: vi.fn(async () => undefined),
}))

vi.mock(
  "../src/integration/handlers/automated-response/system-tools/document-reader",
  () => ({ createDocumentReaderExecutor: vi.fn(() => vi.fn()) }),
)
vi.mock(
  "../src/integration/handlers/automated-response/system-tools/image-reader",
  () => ({
    buildImageConversationContext: vi.fn(),
    createImageReaderExecutor: vi.fn(() => vi.fn()),
  }),
)
vi.mock(
  "../src/integration/handlers/automated-response/system-tools/url-reader",
  () => ({ createUrlReaderExecutor: vi.fn(() => vi.fn()) }),
)

const { replyByAI } = await import(
  "../src/integration/handlers/automated-response/replies"
)

type StreamTextArgs = {
  model: { modelId: string }
  abortSignal: AbortSignal
  onChunk?: (event: { chunk: { type: string } }) => void
}

/** A model that stays silent until its request is aborted, like Vertex under load. */
function silentUntilAborted(args: StreamTextArgs) {
  return {
    textStream: (async function* () {
      if (!args.abortSignal.aborted) {
        await new Promise((resolve) =>
          args.abortSignal.addEventListener("abort", resolve, { once: true }),
        )
      }
      // The AI SDK ends an aborted stream cleanly, without an error.
    })(),
    // Never resolves for an aborted stream.
    totalUsage: new Promise(() => undefined),
  }
}

/** A model that starts answering after `delayMs`. */
function answersAfter(args: StreamTextArgs, text: string, delayMs = 0) {
  return {
    textStream: (async function* () {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      args.onChunk?.({ chunk: { type: "text-delta" } })
      yield text
    })(),
    totalUsage: Promise.resolve({
      inputTokens: 10,
      outputTokens: 5,
      inputTokenDetails: { cacheReadTokens: 0 },
      outputTokenDetails: { reasoningTokens: 0 },
    }),
  }
}

const aiAgent = {
  id: "agent-1",
  workspaceId: "ws-1",
  name: "Agent",
  prompt: "You are a helpful assistant.",
  messages: [],
  isDefault: true,
  isRichResponse: false,
  tools: [],
  webSearchAuthorizedDomains: [],
  models: [{ provider: "gemini", model: "gemini-3.7-flash" }],
  temperature: 0.5,
  maxOutputTokens: 1000,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AIAgentModel

const baseProps = {
  aiAgent,
  conversation: {
    id: "conv-1",
    workspaceId: "ws-1",
    contactId: "contact-1",
    channel: "whatsapp",
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ConversationModel,
  contactInbox: {
    id: "inbox-1",
    contactId: "contact-1",
    inboxId: "channel-inbox-1",
    channel: "whatsapp",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ContactInboxModel,
  channel: "whatsapp",
  messages: [{ role: "user", content: "هلا" }] as ModelMessage[],
  fileOnlyTrigger: false,
}

describe("replyByAI — first-output deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.platformOverride = {
      chatModel: "slow-model",
      fallbackModel: "fast-model",
      location: "global",
    }
    usageMeteringReserveMock.mockImplementation(
      async ({ model }: { model: string }) => ({
        enabled: true,
        operationId: `op-${model}`,
      }),
    )
    usageMeteringSettleLanguageMock.mockResolvedValue(undefined)
    usageMeteringReleaseMock.mockResolvedValue(undefined)
  })

  test("a model that says nothing before the deadline is cut and the next model answers", async () => {
    vi.mocked(streamText).mockImplementation(((args: StreamTextArgs) =>
      args.model.modelId === "slow-model"
        ? silentUntilAborted(args)
        : answersAfter(args, "أهلًا")) as unknown as typeof streamText)

    const startedAt = Date.now()
    const result = await replyByAI(baseProps)

    expect(result).toMatchObject({ responded: true, modelId: "fast-model" })
    // Cut at the 40ms deadline, nowhere near the 10s step timeout.
    expect(Date.now() - startedAt).toBeLessThan(2000)
    expect(sendMessageAndWaitMock).toHaveBeenCalledTimes(1)
    expect(sendMessageAndWaitMock).toHaveBeenCalledWith(
      "conv-1",
      "أهلًا",
      undefined,
    )
    // The silent model's points hold is released, not settled.
    expect(usageMeteringReleaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-slow-model" }),
      expect.any(Error),
    )
    expect(usageMeteringSettleLanguageMock).toHaveBeenCalledTimes(1)
    expect(usageMeteringSettleLanguageMock).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-fast-model" }),
      expect.anything(),
    )
  })

  test("a model that starts answering before the deadline keeps the reply even if it finishes after it", async () => {
    vi.mocked(streamText).mockImplementation(((args: StreamTextArgs) => ({
      textStream: (async function* () {
        args.onChunk?.({ chunk: { type: "text-delta" } })
        await new Promise((resolve) => setTimeout(resolve, 100))
        yield "رد كامل"
      })(),
      totalUsage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 5,
        inputTokenDetails: { cacheReadTokens: 0 },
        outputTokenDetails: { reasoningTokens: 0 },
      }),
    })) as unknown as typeof streamText)

    const result = await replyByAI(baseProps)

    expect(result).toMatchObject({ responded: true, modelId: "slow-model" })
    expect(usageMeteringReleaseMock).not.toHaveBeenCalled()
  })

  test("the last model in the chain is never cut by the deadline", async () => {
    state.platformOverride = {
      chatModel: "only-model",
      fallbackModel: null,
      location: "global",
    }
    vi.mocked(streamText).mockImplementation(((args: StreamTextArgs) =>
      answersAfter(
        args,
        "تأخرت لكن رديت",
        100,
      )) as unknown as typeof streamText)

    const result = await replyByAI(baseProps)

    expect(result).toMatchObject({ responded: true, modelId: "only-model" })
    expect(usageMeteringReleaseMock).not.toHaveBeenCalled()
  })
})
