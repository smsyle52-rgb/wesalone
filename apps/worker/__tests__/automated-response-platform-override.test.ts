import type {
  AIAgentModel,
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { contactVariableService } from "@chatbotx.io/variables"
import { type ModelMessage, streamText } from "ai"
import { beforeEach, describe, expect, test, vi } from "vitest"

type PlatformOverride = {
  chatModel: string
  fallbackModel: string | null
  location: string
} | null

const state = { platformOverride: null as PlatformOverride }

const appendHistoryMock = vi.hoisted(() => vi.fn(async () => undefined))
const getAIIntegrationInDBMock = vi.hoisted(() =>
  vi.fn(async () => ({ id: "integration-1", apiKey: "key" })),
)
const createAIProviderInstanceMock = vi.hoisted(() =>
  vi.fn(() => () => ({ type: "fake-model" })),
)
const getActivePlatformAiOverrideMock = vi.hoisted(() =>
  vi.fn(async () => state.platformOverride),
)
const getPlatformAzureOpenAIChatModelMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ type: "azure-openai-model", modelId })),
)
const getPlatformAzureOpenAIProviderMock = vi.hoisted(() =>
  vi.fn(() => Object.assign(vi.fn(), { tools: {} })),
)
const getPlatformVertexChatModelMock = vi.hoisted(() =>
  vi.fn((modelId: string) => ({ type: "vertex-model", modelId })),
)
const getPlatformVertexProviderMock = vi.hoisted(() =>
  vi.fn(() => Object.assign(vi.fn(), { tools: {} })),
)
const isAutoReplyEnabledForWorkspaceMock = vi.hoisted(() => vi.fn())
const usageMeteringReserveMock = vi.hoisted(() => vi.fn())
const usageMeteringSettleLanguageMock = vi.hoisted(() => vi.fn())
const usageMeteringReleaseMock = vi.hoisted(() => vi.fn())
const getPlatformCapabilityLanguageModelMock = vi.hoisted(() =>
  vi.fn(async () => null),
)

function isPlatformAzureOpenAIModelCandidateImpl(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { platformAzureOpenAI?: unknown }).platformAzureOpenAI === true
  )
}

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
  helpTexts: {
    fallbackLookup:
      "I've found some data, but I couldn't generate a complete answer yet.",
  },
  processStreamingText: vi.fn(async () => ({
    fullText: "Hello from AI",
    messageCount: 1,
  })),
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
  aiContextService: { appendHistory: appendHistoryMock },
  appendFabricationGuard: (p: string) => p,
  appendHandoffPolicy: (p: string) => p,
  appendKnowledgeBaseGuard: (p: string) => p,
  appendToolOutputGuard: (p: string) => p,
  appendUnavailableWebSearchPolicy: (p: string) => p,
  buildPlatformOverrideCandidates: (override: NonNullable<PlatformOverride>) => [
    { platformVertex: true, model: override.chatModel },
  ],
  createAIProviderInstance: createAIProviderInstanceMock,
  createOpenaiCompatibleModelInstance: vi.fn(() => ({
    type: "openai-compatible-model",
  })),
  getActivePlatformAiOverride: getActivePlatformAiOverrideMock,
  getAIIntegrationInDB: getAIIntegrationInDBMock,
  getAIToolset: vi.fn(async () => ({
    tools: {},
    cleanup: undefined,
    webSearchOmitReason: undefined,
  })),
  getPlatformCapabilityLanguageModel: getPlatformCapabilityLanguageModelMock,
  getPlatformAzureOpenAIChatModel: getPlatformAzureOpenAIChatModelMock,
  getPlatformAzureOpenAIProvider: getPlatformAzureOpenAIProviderMock,
  getPlatformVertexChatModel: getPlatformVertexChatModelMock,
  getPlatformVertexProvider: getPlatformVertexProviderMock,
  isPlatformAzureOpenAIModelCandidate: isPlatformAzureOpenAIModelCandidateImpl,
  isPlatformVertexModelCandidate: isPlatformVertexModelCandidateImpl,
  McpClient: vi.fn(),
  normalizeAuthorizedWebSearchDomains: vi.fn(() => []),
  normalizeMcpContent: vi.fn((c: unknown) => c),
}))

async function* emptyAsyncIterable() {
  // intentionally empty — fake textStream for tests
}

vi.mock("ai", () => ({
  streamText: vi.fn(() =>
    Promise.resolve({
      textStream: emptyAsyncIterable(),
      usage: Promise.resolve({ totalTokens: 0 }),
    }),
  ),
  stepCountIs: vi.fn(() => () => false),
}))

vi.mock(
  "../src/integration/handlers/automated-response/replies",
  (importOriginal) => importOriginal(),
)

vi.mock("../src/integration/utils/message", () => ({
  sendMessageAndWait: vi.fn(async () => undefined),
  sendMessageWithRender: vi.fn(async () => undefined),
}))

vi.mock("../../utils/message", () => ({
  sendMessageAndWait: vi.fn(async () => undefined),
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
    isAutoReplyEnabledForWorkspace: isAutoReplyEnabledForWorkspaceMock,
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
  () => ({ createImageReaderExecutor: vi.fn(() => vi.fn()) }),
)
vi.mock(
  "../src/integration/handlers/automated-response/system-tools/url-reader",
  () => ({ createUrlReaderExecutor: vi.fn(() => vi.fn()) }),
)

const { replyByAI } = await import(
  "../src/integration/handlers/automated-response/replies"
)

function makeAIAgent(overrides?: Partial<AIAgentModel>): AIAgentModel {
  return {
    id: "agent-1",
    workspaceId: "ws-1",
    name: "Test Agent",
    prompt: "You are a helpful assistant.",
    messages: [],
    isDefault: true,
    isRichResponse: false,
    tools: [],
    webSearchAuthorizedDomains: [],
    models: [
      { provider: "claude", model: "claude-sonnet-4-6" },
    ] as AIAgentModel["models"],
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

const contactInbox = {
  id: "inbox-1",
  contactId: "contact-1",
  inboxId: "channel-inbox-1",
  channel: "webchat",
  createdAt: new Date(),
  updatedAt: new Date(),
} as ContactInboxModel

const baseProps = {
  conversation: makeConversation(),
  contactInbox,
  channel: "webchat",
  messages: [] as ModelMessage[],
  fileOnlyTrigger: false,
}

describe("replyByAI (DM auto-reply) — platform Azure OpenAI override", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.platformOverride = null
    vi.mocked(streamText).mockImplementation(() =>
      Promise.resolve({
        textStream: emptyAsyncIterable(),
        usage: Promise.resolve({ totalTokens: 0 }),
      }),
    )
    vi.mocked(contactVariableService.replaceAll).mockImplementation(
      async ({ text }) => text,
    )
    isAutoReplyEnabledForWorkspaceMock.mockResolvedValue(true)
    usageMeteringReserveMock.mockResolvedValue({
      enabled: false,
      operationId: "op-1",
    })
    usageMeteringSettleLanguageMock.mockResolvedValue(undefined)
    usageMeteringReleaseMock.mockResolvedValue(undefined)
  })

  test("uses the platform Vertex model and never looks up the workspace's own BYOK integration when enabled", async () => {
    state.platformOverride = {
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
    }

    const result = await replyByAI({
      ...baseProps,
      aiAgent: makeAIAgent(),
    })

    expect(result?.provider).toBe("vertex")
    expect(result?.modelId).toBe("gemini-3.1-flash-lite")
    expect(getPlatformVertexChatModelMock).toHaveBeenCalledWith(
      "gemini-3.1-flash-lite",
      state.platformOverride,
    )
    expect(getAIIntegrationInDBMock).not.toHaveBeenCalled()
    expect(createAIProviderInstanceMock).not.toHaveBeenCalled()
  })

  test("disabled setting (override null) resolves the agent's own configured provider exactly as before", async () => {
    state.platformOverride = null

    const result = await replyByAI({
      ...baseProps,
      aiAgent: makeAIAgent({
        models: [{ provider: "openai", model: "gpt-5.4-mini" }],
      }),
    })

    expect(result?.provider).toBe("openai")
    expect(getPlatformAzureOpenAIChatModelMock).not.toHaveBeenCalled()
    expect(getAIIntegrationInDBMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", provider: "openai" }),
    )
  })
})
