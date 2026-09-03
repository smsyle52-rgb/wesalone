import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  getActiveMock,
  createOpenAIMock,
  createVertexMock,
  azureProviderMock,
  vertexProviderMock,
  envMock,
  defaultCapabilities,
} = vi.hoisted(() => {
  const azureProviderMock = vi.fn((modelId: string) => ({
    type: "azure-openai-chat",
    modelId,
  }))
  const vertexProviderMock = vi.fn((modelId: string) => ({
    type: "vertex-chat",
    modelId,
  }))
  const defaultCapabilities = {
    vision: { provider: "vertex", model: "gemini-3.5-flash" },
    embedding: { provider: "azureOpenAI", model: "wesal-embedding" },
    summarization: { provider: "vertex", model: "gemini-3.5-flash" },
    extraction: { provider: "vertex", model: "gemini-3.5-flash" },
    imageGeneration: { provider: "workspace", model: "gpt-image-1" },
    imageEditing: { provider: "workspace", model: "gpt-image-1" },
    speechToText: { provider: "workspace", model: "gpt-4o-transcribe" },
    textToSpeech: { provider: "workspace", model: "gpt-4o-mini-tts" },
    webSearch: { provider: "vertex", model: "gemini-3.5-flash" },
    documentParsing: { provider: "local", model: "builtin-layout-parser" },
    translation: { provider: "vertex", model: "gemini-3.5-flash" },
  }
  return {
    getActiveMock: vi.fn(),
    createOpenAIMock: vi.fn(() => azureProviderMock),
    createVertexMock: vi.fn(() => vertexProviderMock),
    azureProviderMock,
    vertexProviderMock,
    envMock: {
      AZURE_OPENAI_ENDPOINT: undefined as string | undefined,
      AZURE_OPENAI_API_KEY: undefined as string | undefined,
      AZURE_OPENAI_LOCATION: undefined as string | undefined,
      AZURE_OPENAI_CHAT_DEPLOYMENT: undefined as string | undefined,
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: undefined as string | undefined,
      VERTEX_AI_PROJECT_ID: undefined as string | undefined,
      VERTEX_AI_LOCATION: undefined as string | undefined,
      VERTEX_AI_WIF_PROJECT_NUMBER: undefined as string | undefined,
      VERTEX_AI_WIF_POOL_ID: undefined as string | undefined,
      VERTEX_AI_WIF_PROVIDER_ID: undefined as string | undefined,
      VERTEX_AI_AZURE_AUDIENCE: undefined as string | undefined,
      AZURE_MANAGED_IDENTITY_CLIENT_ID: undefined as string | undefined,
      IDENTITY_ENDPOINT: undefined as string | undefined,
      IDENTITY_HEADER: undefined as string | undefined,
      AI_INTEGRATION_CACHE_TTL_SECONDS: 3600,
    },
    defaultCapabilities,
  }
})

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }))
vi.mock("@ai-sdk/google-vertex", () => ({ createVertex: createVertexMock }))
vi.mock("@chatbotx.io/business", () => ({
  DEFAULT_PLATFORM_AI_CAPABILITIES: defaultCapabilities,
  DEFAULT_PLATFORM_AI_CHAT_MODEL: "gemini-3.5-flash",
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
  getPlatformVertexChatModel,
  isPlatformAzureOpenAIModelCandidate,
  isPlatformVertexModelCandidate,
} = await import("../src/server/platform-provider")

function configureVertexWifEnv() {
  envMock.VERTEX_AI_PROJECT_ID = "khadamatk-auth"
  envMock.VERTEX_AI_LOCATION = "global"
  envMock.VERTEX_AI_WIF_PROJECT_NUMBER = "1067617934225"
  envMock.VERTEX_AI_WIF_POOL_ID = "wesal-azure-prod"
  envMock.VERTEX_AI_WIF_PROVIDER_ID = "azure-wesal-mi"
  envMock.VERTEX_AI_AZURE_AUDIENCE = "api://vertex-wif"
  envMock.AZURE_MANAGED_IDENTITY_CLIENT_ID =
    "272aa924-b831-49a8-8e62-cc6670b71bfc"
  envMock.IDENTITY_ENDPOINT = "http://localhost/identity"
  envMock.IDENTITY_HEADER = "short-lived-local-header"
}

function configureAzureFallbackEnv() {
  envMock.AZURE_OPENAI_ENDPOINT = "https://aoai.example/"
  envMock.AZURE_OPENAI_API_KEY = "test-key"
  envMock.AZURE_OPENAI_LOCATION = "uaenorth"
  envMock.AZURE_OPENAI_CHAT_DEPLOYMENT = "wesal-chat"
  envMock.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "wesal-embedding"
}

beforeEach(() => {
  vi.clearAllMocks()
  getActiveMock.mockResolvedValue(null)
  for (const key of Object.keys(envMock)) {
    if (key !== "AI_INTEGRATION_CACHE_TTL_SECONDS") {
      ;(envMock as Record<string, string | undefined>)[key] = undefined
    }
  }
})

describe("getActivePlatformAiOverride — Vertex WIF fail-closed", () => {
  test("returns null when the setting is disabled or unset", async () => {
    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns null when Workload Identity Federation is incomplete", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "gemini-3.5-flash",
      fallbackModel: null,
      location: "global",
    })
    envMock.VERTEX_AI_PROJECT_ID = "khadamatk-auth"

    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns null when the setting read fails", async () => {
    getActiveMock.mockRejectedValue(
      new Error('relation "PlatformAiSetting" does not exist'),
    )
    configureVertexWifEnv()

    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns Vertex primary and carries Azure fallback internally", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "gemini-3.5-flash",
      fallbackModel: "gemini-2.5-flash",
      location: "global",
      capabilities: defaultCapabilities,
    })
    configureVertexWifEnv()
    configureAzureFallbackEnv()

    await expect(getActivePlatformAiOverride()).resolves.toEqual({
      chatModel: "gemini-3.5-flash",
      fallbackModel: "gemini-2.5-flash",
      location: "global",
      projectId: "khadamatk-auth",
      capabilities: defaultCapabilities,
      azureOpenAI: {
        endpoint: "https://aoai.example/",
        apiKey: "test-key",
        location: "uaenorth",
        chatDeployment: "wesal-chat",
        embeddingDeployment: "wesal-embedding",
      },
    })
  })
})

describe("getPlatformAiEnvStatus — presence only", () => {
  test("reports booleans without exposing infrastructure values or secrets", () => {
    configureVertexWifEnv()
    configureAzureFallbackEnv()

    const status = getPlatformAiEnvStatus()

    expect(status).toEqual({
      hasVertexProjectId: true,
      hasVertexLocationOverride: true,
      hasWorkloadIdentityFederation: true,
      hasAzureOpenAIFallback: true,
    })
    expect(JSON.stringify(status)).not.toContain("khadamatk-auth")
    expect(JSON.stringify(status)).not.toContain("test-key")
    expect(JSON.stringify(status)).not.toContain("short-lived-local-header")
  })
})

describe("platform Gemini then Azure OpenAI candidates", () => {
  test("creates Vertex primary and optional Vertex fallback before Azure", () => {
    const candidates = buildPlatformOverrideCandidates({
      chatModel: "gemini-3.5-flash",
      fallbackModel: "gemini-2.5-flash",
      location: "global",
      projectId: "khadamatk-auth",
      capabilities: defaultCapabilities,
      azureOpenAI: {
        endpoint: "https://aoai.example/",
        apiKey: "test-key",
        location: "uaenorth",
        chatDeployment: "wesal-chat",
        embeddingDeployment: "wesal-embedding",
      },
    })

    expect(candidates).toEqual([
      { platformVertex: true, model: "gemini-3.5-flash" },
      { platformVertex: true, model: "gemini-2.5-flash" },
      { platformAzureOpenAI: true, model: "wesal-chat" },
    ])
    expect(isPlatformVertexModelCandidate(candidates[0])).toBe(true)
    expect(isPlatformAzureOpenAIModelCandidate(candidates[2])).toBe(true)
    expect(isPlatformVertexModelCandidate({ provider: "openai" })).toBe(false)
    expect(isPlatformAzureOpenAIModelCandidate({ provider: "openai" })).toBe(
      false,
    )
  })
})

describe("model construction", () => {
  test("uses Azure OpenAI v1 endpoint only for fallback", () => {
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

  test("uses WIF-backed Google Auth for Vertex primary", () => {
    configureVertexWifEnv()
    getPlatformVertexChatModel("gemini-3.5-flash", {
      projectId: "khadamatk-auth",
      location: "global",
    })

    expect(createVertexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "khadamatk-auth",
        location: "global",
        googleAuthOptions: expect.objectContaining({
          projectId: "khadamatk-auth",
          credentials: expect.objectContaining({ type: "external_account" }),
        }),
      }),
    )
    expect(vertexProviderMock).toHaveBeenCalledWith("gemini-3.5-flash")
  })
})
