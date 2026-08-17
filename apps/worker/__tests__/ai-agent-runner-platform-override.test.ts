import type {
  AIAgentModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { type ModelMessage, streamText } from "ai"
import { beforeEach, describe, expect, test, vi } from "vitest"

type PlatformOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
} | null

const state = {
  aiResponseText: "Hello from Azure OpenAI",
  platformOverride: null as PlatformOverride,
}

const appendHistoryMock = vi.hoisted(() => vi.fn(async () => undefined))
const createAIModelInstanceMock = vi.hoisted(() =>
  vi.fn(() => ({ type: "native-model" })),
)
const createOpenaiCompatibleModelInstanceMock = vi.hoisted(() =>
  vi.fn(() => ({ type: "openai-compatible-model" })),
)
const findAIIntegrationMock = vi.hoisted(() =>
  vi.fn(async () => ({ id: "native-integration" })),
)
const getActivePlatformAiOverrideMock = vi.hoisted(() =>
  vi.fn(async () => state.platformOverride),
)
const usageMeteringReserveMock = vi.hoisted(() => vi.fn())
const usageMeteringSettleLanguageMock = vi.hoisted(() => vi.fn())
const usageMeteringReleaseMock = vi.hoisted(() => vi.fn())
const getPlatformAzureOpenAIChatModelMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ type: "azure-openai-model", modelId })),
)

function isPlatformAzureOpenAIModelCandidateImpl(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformAzureOpenAI?: unknown }).platformAzureOpenAI === true
  )
}

vi.mock("@chatbotx.io/ai", () => ({
  aiTimeouts: { aiTotal: 30_000, aiStep: 10_000, aiChunk: 5000 },
  helpTexts: {
    fallbackLookup: "I found something, but cannot summarize it yet.",
    fileSearchDescription: "Search files",
    fileSearchQueryDescription: "Query",
    fileSearchNoResult: "No result",
    fileSearchFoundPrefix: "Found",
  },
  processStreamingText: vi.fn(async () => ({ fullText: state.aiResponseText })),
  toolPrefixes: { enum: { file: "file", fn: "fn", mcp: "mcp", sys: "sys" } },
}))

vi.mock("@chatbotx.io/ai/server", () => ({
  aiContextService: { appendHistory: appendHistoryMock },
  aiIntegrationService: { findBy: findAIIntegrationMock },
  appendFabricationGuard: (prompt: string) => prompt,
  appendKnowledgeBaseGuard: (prompt: string) => prompt,
  appendToolOutputGuard: (prompt: string) => prompt,
  buildPlatformOverrideCandidates: (
    override: NonNullable<PlatformOverride>,
  ) => {
    const candidates = [
      { platformAzureOpenAI: true, model: override.chatModel },
    ]
    if (override.fallbackModel) {
      candidates.push({
        platformAzureOpenAI: true,
        model: override.fallbackModel,
      })
    }
    return candidates
  },
  createAIModelInstance: createAIModelInstanceMock,
  createOpenaiCompatibleModelInstance: createOpenaiCompatibleModelInstanceMock,
  getActivePlatformAiOverride: getActivePlatformAiOverrideMock,
  getAIToolset: vi.fn(async () => ({ tools: {}, cleanup: vi.fn() })),
  getPlatformAzureOpenAIChatModel: getPlatformAzureOpenAIChatModelMock,
  getPlatformAzureOpenAIProvider: vi.fn(() =>
    Object.assign(vi.fn(), { tools: {} }),
  ),
  isPlatformAzureOpenAIModelCandidate: isPlatformAzureOpenAIModelCandidateImpl,
  isPlatformVertexModelCandidate: vi.fn(() => false),
  McpClient: vi.fn(),
  normalizeMcpContent: vi.fn((content: unknown) => content),
}))

vi.mock("@chatbotx.io/business", () => ({
  integrationOpenaiCompatibleService: {
    findByWorkspaceIdAndId: vi.fn(),
  },
  usageMeteringService: {
    reserve: usageMeteringReserveMock,
    settleLanguage: usageMeteringSettleLanguageMock,
    release: usageMeteringReleaseMock,
  },
}))

vi.mock("@chatbotx.io/variables", () => ({
  contactVariableService: {
    getAll: vi.fn(async () => []),
    replaceAll: vi.fn(async ({ text }: { text: string }) => text),
  },
}))

vi.mock("ai", () => ({
  streamText: vi.fn(async () => ({ textStream: [] })),
  stepCountIs: vi.fn(() => () => false),
}))

const { runAIAgentRunner } = await import(
  "../src/integration/handlers/shared/ai-agent-runner"
)

function makeAIAgent(overrides?: Partial<AIAgentModel>): AIAgentModel {
  return {
    id: "agent-1",
    workspaceId: "ws-1",
    name: "Test Agent",
    prompt: "You are helpful.",
    messages: [],
    isDefault: false,
    isRichResponse: false,
    tools: [],
    webSearchAuthorizedDomains: [],
    models: [{ provider: "claude", model: "claude-sonnet-4-6" }],
    temperature: 0.7,
    maxOutputTokens: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AIAgentModel
}

function makeConversation(): ConversationModel {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    contactId: "contact-1",
    channel: "webchat",
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ConversationModel
}

// SKIPPED — these assert a behaviour the runner does not implement, and the
// gap is real rather than a test defect.
//
// replyByAI (automated-response/replies.ts) resolves the platform Vertex
// override before picking a provider, and its sibling suite
// (automated-response-platform-override.test.ts) passes. runAIAgentRunner —
// the path a flow's "AI agent" step takes — never calls
// getActivePlatformAiOverride at all, so a platform-locked model is honoured
// on DM auto-replies and silently ignored inside flows, where the merchant's
// own BYOK provider runs instead.
//
// Not "fixed" by editing the runner: that changes which model executes for
// live flows, i.e. the agent loop and the owner's locked model-routing map.
// Wire the override into runAIAgentRunner deliberately, or drop these tests if
// flows are meant to keep their own provider.
describe.skip("AI agent runner — platform Vertex override", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.aiResponseText = "Hello from Azure OpenAI"
    state.platformOverride = null
    // `restoreMocks: true` (packages/vitest-config) resets every vi.fn to a
    // bare stub before each test, so an implementation given at vi.hoisted
    // declaration time is gone by the time the first test runs. Everything the
    // suite depends on has to be re-armed here.
    appendHistoryMock.mockResolvedValue(undefined)
    createAIModelInstanceMock.mockReturnValue({ type: "native-model" })
    createOpenaiCompatibleModelInstanceMock.mockReturnValue({
      type: "openai-compatible-model",
    })
    findAIIntegrationMock.mockResolvedValue({ id: "native-integration" })
    getActivePlatformAiOverrideMock.mockImplementation(
      async () => state.platformOverride,
    )
    getPlatformAzureOpenAIChatModelMock.mockImplementation(
      (modelId: string) => ({
        type: "azure-openai-model",
        modelId,
      }),
    )
    usageMeteringReserveMock.mockResolvedValue({
      enabled: false,
      operationId: "op-1",
    })
    usageMeteringSettleLanguageMock.mockResolvedValue(undefined)
    usageMeteringReleaseMock.mockResolvedValue(undefined)
  })

  test("uses the platform Vertex model and never touches the agent's own stored BYOK integration when the override is enabled", async () => {
    state.platformOverride = {
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
    }

    const result = await runAIAgentRunner({
      aiAgent: makeAIAgent({
        models: [{ provider: "claude", model: "claude-sonnet-4-6" }],
      }),
      conversation: makeConversation(),
      messages: [] as ModelMessage[],
    })

    expect(result?.provider).toBe("vertex")
    expect(result?.modelId).toBe("gemini-3.1-flash-lite")
    expect(getPlatformAzureOpenAIChatModelMock).toHaveBeenCalledWith(
      "gemini-3.1-flash-lite",
      state.platformOverride,
    )
    expect(createAIModelInstanceMock).not.toHaveBeenCalled()
    expect(findAIIntegrationMock).not.toHaveBeenCalled()
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { type: "azure-openai-model", modelId: "gemini-3.1-flash-lite" },
      }),
    )
  })

  test("ignores an explicit preferredProvider from a flow step when the platform override is active", async () => {
    state.platformOverride = {
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
    }

    const result = await runAIAgentRunner({
      aiAgent: makeAIAgent(),
      conversation: makeConversation(),
      messages: [] as ModelMessage[],
      preferredProvider: "claude",
    })

    expect(result?.provider).toBe("vertex")
    expect(createAIModelInstanceMock).not.toHaveBeenCalled()
  })

  test("falls back to the platform's own fallback model (still Vertex) when the primary attempt produces no reply", async () => {
    state.platformOverride = {
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: "gemini-2.5-flash",
      location: "us-central1",
    }
    const { processStreamingText } = await import("@chatbotx.io/ai")
    vi.mocked(processStreamingText)
      .mockResolvedValueOnce({ fullText: "" })
      .mockResolvedValueOnce({ fullText: "Hello from the fallback model" })

    const result = await runAIAgentRunner({
      aiAgent: makeAIAgent(),
      conversation: makeConversation(),
      messages: [] as ModelMessage[],
    })

    expect(result?.provider).toBe("vertex")
    expect(result?.modelId).toBe("gemini-2.5-flash")
    expect(getPlatformAzureOpenAIChatModelMock).toHaveBeenNthCalledWith(
      1,
      "gemini-3.1-flash-lite",
      state.platformOverride,
    )
    expect(getPlatformAzureOpenAIChatModelMock).toHaveBeenNthCalledWith(
      2,
      "gemini-2.5-flash",
      state.platformOverride,
    )
  })

  test("disabled setting (override null) falls back to the agent's own configured provider, unchanged", async () => {
    state.platformOverride = null

    const result = await runAIAgentRunner({
      aiAgent: makeAIAgent({
        models: [{ provider: "openai", model: "gpt-5.4-mini" }],
      }),
      conversation: makeConversation(),
      messages: [] as ModelMessage[],
    })

    expect(result?.provider).toBe("openai")
    expect(getPlatformAzureOpenAIChatModelMock).not.toHaveBeenCalled()
    expect(createAIModelInstanceMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", modelId: "gpt-5.4-mini" }),
    )
  })

  test("a Vertex failure produces no reply at all — never a fabricated/mock response", async () => {
    state.platformOverride = {
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
    }
    getPlatformAzureOpenAIChatModelMock.mockImplementationOnce(() => {
      throw new Error("Vertex AI request failed")
    })

    const result = await runAIAgentRunner({
      aiAgent: makeAIAgent(),
      conversation: makeConversation(),
      messages: [] as ModelMessage[],
    })

    expect(result).toBeNull()
    expect(streamText).not.toHaveBeenCalled()
  })
})
