import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  getActiveMock,
  createVertexMock,
  vertexProviderMock,
  envMock,
  defaultCapabilities,
} = vi.hoisted(() => {
  const vertexProviderMock = vi.fn((modelId: string) => ({
    type: "vertex-chat",
    modelId,
  }))
  const defaultCapabilities = {
    vision: { provider: "vertex", model: "gemini-2.5-pro" },
    embedding: { provider: "vertex", model: "text-embedding-005" },
    summarization: { provider: "vertex", model: "gemini-3.1-flash-lite" },
    extraction: { provider: "vertex", model: "gemini-2.5-pro" },
    imageGeneration: {
      provider: "vertex",
      model: "imagen-4.0-ultra-generate-001",
    },
    imageEditing: { provider: "vertex", model: "gemini-3.1-flash-image" },
    speechToText: { provider: "vertex", model: "chirp_3" },
    textToSpeech: { provider: "googleCloud", model: "chirp3-hd" },
    webSearch: { provider: "vertex", model: "gemini-2.5-flash" },
    documentParsing: { provider: "local", model: "builtin-layout-parser" },
    translation: { provider: "googleCloud", model: "translation-llm" },
  }
  return {
    getActiveMock: vi.fn(),
    createVertexMock: vi.fn(() => vertexProviderMock),
    vertexProviderMock,
    envMock: {
      VERTEX_AI_PROJECT_ID: undefined as string | undefined,
      VERTEX_AI_LOCATION: undefined as string | undefined,
      AI_INTEGRATION_CACHE_TTL_SECONDS: 3600,
    },
    defaultCapabilities,
  }
})

vi.mock("@ai-sdk/google-vertex", () => ({ createVertex: createVertexMock }))
vi.mock("@chatbotx.io/business", () => ({
  DEFAULT_PLATFORM_AI_CAPABILITIES: defaultCapabilities,
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
  getPlatformVertexChatModel,
  isPlatformVertexModelCandidate,
} = await import("../src/server/platform-provider")

beforeEach(() => {
  vi.clearAllMocks()
  getActiveMock.mockResolvedValue(null)
  envMock.VERTEX_AI_PROJECT_ID = undefined
  envMock.VERTEX_AI_LOCATION = undefined
})

describe("getActivePlatformAiOverride — fail-closed by construction", () => {
  test("returns null when the setting is disabled/unset — callers fall back to the agent's own provider/model", async () => {
    getActiveMock.mockResolvedValue(null)
    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns null (never throws) when enabled but VERTEX_AI_PROJECT_ID is not configured — a deployment misconfiguration must degrade to the agent's own provider, not crash reply generation platform-wide", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
    })
    envMock.VERTEX_AI_PROJECT_ID = undefined

    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns null (never throws) when the DB read itself fails — e.g. this code deployed before the PlatformAiSetting migration ran", async () => {
    getActiveMock.mockRejectedValue(
      new Error('relation "PlatformAiSetting" does not exist'),
    )
    envMock.VERTEX_AI_PROJECT_ID = "my-project"

    await expect(getActivePlatformAiOverride()).resolves.toBeNull()
  })

  test("returns the merged override when active and configured — env location overrides the stored default", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: "gemini-2.5-flash",
      location: "us-central1",
    })
    envMock.VERTEX_AI_PROJECT_ID = "my-project"
    envMock.VERTEX_AI_LOCATION = "europe-west1"

    await expect(getActivePlatformAiOverride()).resolves.toEqual({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: "gemini-2.5-flash",
      location: "europe-west1",
      projectId: "my-project",
      capabilities: defaultCapabilities,
    })
  })

  test("falls back to the DB-stored location when no env override is set", async () => {
    getActiveMock.mockResolvedValue({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
    })
    envMock.VERTEX_AI_PROJECT_ID = "my-project"

    const result = await getActivePlatformAiOverride()
    expect(result?.location).toBe("us-central1")
  })
})

describe("getPlatformAiEnvStatus — presence only, never leaks the actual value", () => {
  test("reports booleans, not the underlying project id/location strings", () => {
    envMock.VERTEX_AI_PROJECT_ID = "super-secret-looking-project-id"
    envMock.VERTEX_AI_LOCATION = "us-central1"

    const status = getPlatformAiEnvStatus()

    expect(status).toEqual({ hasProjectId: true, hasLocationOverride: true })
    expect(JSON.stringify(status)).not.toContain(
      "super-secret-looking-project-id",
    )
  })

  test("reports false when unset", () => {
    expect(getPlatformAiEnvStatus()).toEqual({
      hasProjectId: false,
      hasLocationOverride: false,
    })
  })
})

describe("platform Vertex model candidates — reuse the agent's own fallback-chain shape", () => {
  test("primary only when no fallback is configured", () => {
    const candidates = buildPlatformOverrideCandidates({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: "us-central1",
      projectId: "p",
    })

    expect(candidates).toEqual([
      { platformVertex: true, model: "gemini-3.1-flash-lite" },
    ])
  })

  test("primary + fallback, both flagged as platform Vertex candidates", () => {
    const candidates = buildPlatformOverrideCandidates({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: "gemini-2.5-flash",
      location: "us-central1",
      projectId: "p",
    })

    expect(candidates).toEqual([
      { platformVertex: true, model: "gemini-3.1-flash-lite" },
      { platformVertex: true, model: "gemini-2.5-flash" },
    ])
    expect(candidates.every(isPlatformVertexModelCandidate)).toBe(true)
  })

  test("isPlatformVertexModelCandidate rejects a normal agent-stored BYOK provider entry", () => {
    expect(
      isPlatformVertexModelCandidate({
        provider: "openai",
        model: "gpt-5.4-mini",
      }),
    ).toBe(false)
    expect(
      isPlatformVertexModelCandidate({
        kind: "openaiCompatible",
        integrationId: "int-1",
        model: "local-model",
      }),
    ).toBe(false)
    expect(isPlatformVertexModelCandidate(null)).toBe(false)
    expect(isPlatformVertexModelCandidate(undefined)).toBe(false)
  })
})

describe("Vertex model construction — Application Default Credentials, never an API key", () => {
  test("getPlatformVertexChatModel builds via createVertex with project/location only", () => {
    getPlatformVertexChatModel("gemini-3.1-flash-lite", {
      location: "us-central1",
      projectId: "my-project",
    })

    expect(createVertexMock).toHaveBeenCalledWith({
      project: "my-project",
      location: "us-central1",
    })
    const passedOptions = createVertexMock.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >
    expect(passedOptions).not.toHaveProperty("apiKey")
    expect(passedOptions).not.toHaveProperty("googleAuthOptions")
    expect(vertexProviderMock).toHaveBeenCalledWith("gemini-3.1-flash-lite")
  })
})
