import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  getActiveMock,
  createOpenAIMock,
  azureProviderMock,
  envMock,
  defaultCapabilities,
} = vi.hoisted(() => {
  const azureProviderMock = vi.fn((modelId: string) => ({
    type: "azure-openai-chat",
    modelId,
  }))
  const defaultCapabilities = {
    vision: { provider: "azureOpenAI", model: "wesal-chat" },
    embedding: { provider: "azureOpenAI", model: "wesal-embedding" },
    summarization: { provider: "azureOpenAI", model: "wesal-chat" },
    extraction: { provider: "azureOpenAI", model: "wesal-chat" },
    imageGeneration: { provider: "workspace", model: "gpt-image-1" },
    imageEditing: { provider: "workspace", model: "gpt-image-1" },
    speechToText: { provider: "workspace", model: "gpt-4o-transcribe" },
    textToSpeech: { provider: "workspace", model: "gpt-4o-mini-tts" },
    webSearch: { provider: "azureOpenAI", model: "wesal-chat" },
    documentParsing: { provider: "local", model: "builtin-layout-parser" },
    translation: { provider: "azureOpenAI", model: "wesal-chat" },
  }
  return {
    getActiveMock: vi.fn(),
    createOpenAIMock: vi.fn(() => azureProviderMock),
    azureProviderMock,
    envMock: {
      AZURE_OPENAI_ENDPOINT: undefined as string | undefined,
      AZURE_OPENAI_API_KEY: undefined as string | undefined,
      AZURE_OPENAI_LOCATION: undefined as string | undefined,
      AZURE_OPENAI_CHAT_DEPLOYMENT: undefined as string | undefined,
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: undefined as string | undefined,
      AI_INTEGRATION_CACHE_TTL_SECONDS: 3600,
    },
    defaultCapabilities,
  }
})

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }))
vi.mock("@chatbotx.io/business", () => ({
  DEFAULT_PLATFORM_AI_CAPABILITIES: defaultCapabilities,
  DEFAULT_PLATFORM_AI_CHAT_MODEL: "wesal-chat",
  DEFAULT_PLATFORM_AI_EMBEDDING_MODEL: "wesal-embedding",
  platformAiSettingService: { getActive: getActiveMock },
}))
vi.mock("../src/keys", () => ({ env: envMock }))
vi.mock("../src/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const {
  buildPlatformOverrideCandidates,
  getActivePlatformAiOverride,
  getPlatformAiEnvStatus,
  getPlatformAzureOpenAIChatModel,
  isPlatformAzureOpenAIModelCandidate,
} = await import("../src/server/platform-provider")

beforeEach(() => {
  vi.clearAllMocks()
  getActiveMock.mockResolvedValue(null)
  envMock.AZURE_OPENAI_ENDPOINT = undefined
  envMock.AZURE_OPENAI_API_KEY = undefined
  envMock.AZURE_OPENAI_LOCATION = undefined
  envMock.AZURE_OPENAI_CHAT_DEPLOYMENT = undefined
  envMock.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = undefined
})

describe("getActivePlatformAiOverride — Azure OpenAI fail-closed", () => {
  test("returns null when the setting is disabled/unset", async () => {
    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns null when endpoint or API key is missing", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "wesal-chat",
      fallbackModel: null,
      location: "uaenorth",
    })

    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns null when the setting read fails", async () => {
    getActiveMock.mockRejectedValue(
      new Error('relation "PlatformAiSetting" does not exist'),
    )
    envMock.AZURE_OPENAI_ENDPOINT = "https://aoai.example/"
    envMock.AZURE_OPENAI_API_KEY = "test-key"

    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns the merged Azure override while keeping endpoint and key internal", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "wesal-chat",
      fallbackModel: "wesal-chat-fallback",
      location: "uaenorth",
    })
    envMock.AZURE_OPENAI_ENDPOINT = "https://aoai.example/"
    envMock.AZURE_OPENAI_API_KEY = "test-key"
    envMock.AZURE_OPENAI_LOCATION = "uaenorth"

    await expect(getActivePlatformAiOverride()).resolves.toEqual({
      chatModel: "wesal-chat",
      fallbackModel: "wesal-chat-fallback",
      location: "uaenorth",
      endpoint: "https://aoai.example/",
      apiKey: "test-key",
      capabilities: defaultCapabilities,
    })
  })

  test("maps a legacy Gemini row to the Azure chat deployment", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "gemini-3.1-flash-lite",
      embeddingModel: "text-embedding-005",
      fallbackModel: "gemini-2.5-flash",
      location: "global",
    })
    envMock.AZURE_OPENAI_ENDPOINT = "https://aoai.example/"
    envMock.AZURE_OPENAI_API_KEY = "test-key"

    const result = await getActivePlatformAiOverride()
    expect(result?.chatModel).toBe("wesal-chat")
    expect(result?.fallbackModel).toBeNull()
  })
})

describe("getPlatformAiEnvStatus — presence only", () => {
  test("reports booleans without exposing endpoint or key", () => {
    envMock.AZURE_OPENAI_ENDPOINT = "https://aoai.example/"
    envMock.AZURE_OPENAI_API_KEY = "test-key"
    envMock.AZURE_OPENAI_LOCATION = "uaenorth"

    const status = getPlatformAiEnvStatus()

    expect(status).toEqual({
      hasEndpoint: true,
      hasApiKey: true,
      hasLocationOverride: true,
    })
    expect(JSON.stringify(status)).not.toContain("aoai.example")
    expect(JSON.stringify(status)).not.toContain("test-key")
  })

  test("reports false when unset", () => {
    expect(getPlatformAiEnvStatus()).toEqual({
      hasEndpoint: false,
      hasApiKey: false,
      hasLocationOverride: false,
    })
  })
})

describe("platform Azure OpenAI model candidates", () => {
  test("creates primary and optional fallback candidates", () => {
    const candidates = buildPlatformOverrideCandidates({
      chatModel: "wesal-chat",
      fallbackModel: "wesal-chat-fallback",
      location: "uaenorth",
      endpoint: "https://aoai.example/",
      apiKey: "test-key",
      capabilities: defaultCapabilities,
    })

    expect(candidates).toEqual([
      { platformAzureOpenAI: true, model: "wesal-chat" },
      { platformAzureOpenAI: true, model: "wesal-chat-fallback" },
    ])
    expect(candidates.every(isPlatformAzureOpenAIModelCandidate)).toBe(true)
    expect(
      isPlatformAzureOpenAIModelCandidate({
        provider: "openai",
        model: "workspace-model",
      }),
    ).toBe(false)
  })
})

describe("Azure OpenAI model construction", () => {
  test("uses Azure OpenAI v1 endpoint and the api-key header", () => {
    getPlatformAzureOpenAIChatModel("wesal-chat", {
      endpoint: "https://aoai.example/",
      apiKey: "test-key",
    })

    expect(createOpenAIMock).toHaveBeenCalledWith({
      baseURL: "https://aoai.example/openai/v1",
      apiKey: "test-key",
      headers: { "api-key": "test-key" },
      name: "azure-openai",
    })
    expect(azureProviderMock).toHaveBeenCalledWith("wesal-chat")
  })
})
