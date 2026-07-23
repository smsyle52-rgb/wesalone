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
  aiResponseText: "Hello from Vertex",
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
const getPlatformVertexChatModelMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ type: "vertex-model", modelId })),
)

function isPlatformVertexModelCandidateImpl(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformVertex?: unknown }).platformVertex === true
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
    const candidates = [{ platformVertex: true, model: override.chatModel }]
    if (override.fallbackModel) {
      candidates.push({ platformVertex: true, model: override.fallbackModel })
    }
    return candidates
  },
  createAIModelInstance: createAIModelInstanceMock,
  createOpenaiCompatibleModelInstance: createOpenaiCompatibleModelInstanceMock,
  getActivePlatformAiOverride: getActivePlatformAiOverrideMock,
  getAIToolset: vi.fn(async () => ({ tools: {}, cleanup: vi.fn() })),
  getPlatformVertexChatModel: getPlatformVertexChatModelMock,
  isPlatformVertexModelCandidate: isPlatformVertexModelCandidateImpl,
  McpClient: vi.fn(),
  normalizeMcpContent: vi.fn((content: unknown) => content),
}))

vi.mock("@chatbotx.io/business", () => ({
  integrationOpenaiCompatibleService: {
    findByWorkspaceIdAndId: vi.fn(),
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

describe("AI agent runner — platform Vertex override", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.aiResponseText = "Hello from Vertex"
    state.platformOverride = null
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
    expect(getPlatformVertexChatModelMock).toHaveBeenCalledWith(
      "gemini-3.1-flash-lite",
      state.platformOverride,
    )
    expect(createAIModelInstanceMock).not.toHaveBeenCalled()
    expect(findAIIntegrationMock).not.toHaveBeenCalled()
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { type: "vertex-model", modelId: "gemini-3.1-flash-lite" },
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
    expect(getPlatformVertexChatModelMock).toHaveBeenNthCalledWith(
      1,
      "gemini-3.1-flash-lite",
      state.platformOverride,
    )
    expect(getPlatformVertexChatModelMock).toHaveBeenNthCalledWith(
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
    expect(getPlatformVertexChatModelMock).not.toHaveBeenCalled()
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
    getPlatformVertexChatModelMock.mockImplementationOnce(() => {
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
