import { beforeEach, describe, expect, test, vi } from "vitest"
import { makeChain } from "./support/mock-chain"

const platformAiSettingModel = {
  id: "id-column",
  provider: "provider-column",
  chatModel: "chatModel-column",
  embeddingModel: "embeddingModel-column",
  location: "location-column",
  fallbackModel: "fallbackModel-column",
  capabilities: "capabilities-column",
  enabled: "enabled-column",
  updatedByUserId: "updatedByUserId-column",
}

vi.mock("@chatbotx.io/database/schema", () => ({ platformAiSettingModel }))

let findFirstResult: Record<string, unknown> | null = null
let updateReturnRows: unknown[] = []
let insertReturnRows: unknown[] = []

const dbMock = {
  query: {
    platformAiSettingModel: {
      findFirst: vi.fn(async () => findFirstResult),
    },
  },
  update: vi.fn(() => makeChain(updateReturnRows)),
  insert: vi.fn(() => makeChain(insertReturnRows)),
}

vi.mock("@chatbotx.io/database/client", () => ({
  db: dbMock,
  eq: vi.fn((...args: unknown[]) => args),
}))

const { withCacheMock, invalidateCacheKeysMock } = vi.hoisted(() => ({
  withCacheMock: vi.fn(
    async (_key: string, callback: () => Promise<unknown> | unknown) =>
      await callback(),
  ),
  invalidateCacheKeysMock: vi.fn(async () => undefined),
}))

vi.mock("@chatbotx.io/redis", () => ({
  withCache: withCacheMock,
  invalidateCacheKeys: invalidateCacheKeysMock,
}))

const {
  platformAiSettingService,
  DEFAULT_PLATFORM_AI_CHAT_MODEL,
  DEFAULT_PLATFORM_AI_CAPABILITIES,
  DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
  DEFAULT_PLATFORM_AI_LOCATION,
  PLATFORM_AI_PROVIDER,
} = await import("../src/platform-ai-setting/service")

beforeEach(() => {
  vi.clearAllMocks()
  findFirstResult = null
  updateReturnRows = []
  insertReturnRows = []
})

describe("platformAiSettingService — fixed provider + safe defaults", () => {
  test("provider is fixed to vertex", () => {
    expect(PLATFORM_AI_PROVIDER).toBe("vertex")
  })

  test("default chat model is gemini-3.1-flash-lite", () => {
    expect(DEFAULT_PLATFORM_AI_CHAT_MODEL).toBe("gemini-3.1-flash-lite")
  })

  test("get() returns safe, disabled defaults when no row exists yet", async () => {
    findFirstResult = null

    const setting = await platformAiSettingService.get()

    expect(setting).toEqual({
      provider: "vertex",
      chatModel: DEFAULT_PLATFORM_AI_CHAT_MODEL,
      embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
      location: DEFAULT_PLATFORM_AI_LOCATION,
      fallbackModel: null,
      capabilities: DEFAULT_PLATFORM_AI_CAPABILITIES,
      enabled: false,
      updatedByUserId: null,
      updatedAt: null,
    })
  })
})

describe("platformAiSettingService.getActive — the one check the AI runtime needs", () => {
  test("returns null when disabled — callers must fall back to the agent's own provider/model", async () => {
    findFirstResult = {
      id: "setting-1",
      provider: "vertex",
      chatModel: "gemini-3.1-pro-preview",
      embeddingModel: "text-embedding-005",
      location: "us-central1",
      fallbackModel: null,
      enabled: false,
      updatedByUserId: "admin-1",
      updatedAt: new Date(),
    }

    await expect(platformAiSettingService.getActive()).resolves.toBeNull()
  })

  test("returns the active override when enabled", async () => {
    findFirstResult = {
      id: "setting-1",
      provider: "vertex",
      chatModel: "gemini-3.1-pro-preview",
      embeddingModel: "text-embedding-005",
      location: "us-central1",
      fallbackModel: "gemini-2.5-flash",
      enabled: true,
      updatedByUserId: "admin-1",
      updatedAt: new Date(),
    }

    await expect(platformAiSettingService.getActive()).resolves.toEqual({
      chatModel: "gemini-3.1-pro-preview",
      fallbackModel: "gemini-2.5-flash",
      location: "us-central1",
      embeddingModel: "text-embedding-005",
      capabilities: DEFAULT_PLATFORM_AI_CAPABILITIES,
    })
  })

  test("is cached via withCache", async () => {
    findFirstResult = null
    await platformAiSettingService.getActive()
    expect(withCacheMock).toHaveBeenCalledWith(
      "platform-ai-setting:active",
      expect.any(Function),
      expect.objectContaining({ ttl: expect.any(Number) }),
    )
  })
})

describe("platformAiSettingService.upsert — only chatModel/fallbackModel/enabled are ever caller-controlled", () => {
  test("creates the singleton row with fixed embeddingModel/location/provider on first save", async () => {
    findFirstResult = null
    insertReturnRows = [
      {
        id: "setting-1",
        provider: "vertex",
        chatModel: "gemini-3.1-flash-lite",
        embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
        location: DEFAULT_PLATFORM_AI_LOCATION,
        fallbackModel: null,
        enabled: true,
        updatedByUserId: "admin-1",
        updatedAt: new Date(),
      },
    ]

    await platformAiSettingService.upsert({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: null,
      location: DEFAULT_PLATFORM_AI_LOCATION,
      capabilities: DEFAULT_PLATFORM_AI_CAPABILITIES,
      enabled: true,
      updatedByUserId: "admin-1",
    })

    const usedChain = dbMock.insert.mock.results.at(-1)?.value as {
      values: ReturnType<typeof vi.fn>
    }
    const [values] = usedChain.values.mock.calls.at(-1) ?? []
    expect(values).toMatchObject({
      provider: "vertex",
      embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
      location: DEFAULT_PLATFORM_AI_LOCATION,
      chatModel: "gemini-3.1-flash-lite",
      enabled: true,
      updatedByUserId: "admin-1",
    })
  })

  test("updates the existing row in place instead of creating a second one", async () => {
    findFirstResult = { id: "setting-1" }
    updateReturnRows = [
      {
        id: "setting-1",
        provider: "vertex",
        chatModel: "gemini-2.5-flash",
        embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
        location: DEFAULT_PLATFORM_AI_LOCATION,
        fallbackModel: null,
        enabled: false,
        updatedByUserId: "admin-2",
        updatedAt: new Date(),
      },
    ]

    await platformAiSettingService.upsert({
      chatModel: "gemini-2.5-flash",
      fallbackModel: null,
      location: DEFAULT_PLATFORM_AI_LOCATION,
      capabilities: DEFAULT_PLATFORM_AI_CAPABILITIES,
      enabled: false,
      updatedByUserId: "admin-2",
    })

    expect(dbMock.insert).not.toHaveBeenCalled()
    expect(dbMock.update).toHaveBeenCalled()
  })

  test("invalidates the active-setting cache on every save so the new value takes effect immediately", async () => {
    findFirstResult = { id: "setting-1" }
    updateReturnRows = [
      {
        id: "setting-1",
        provider: "vertex",
        chatModel: "gemini-2.5-flash",
        embeddingModel: DEFAULT_PLATFORM_AI_EMBEDDING_MODEL,
        location: DEFAULT_PLATFORM_AI_LOCATION,
        fallbackModel: null,
        enabled: false,
        updatedByUserId: "admin-2",
        updatedAt: new Date(),
      },
    ]

    await platformAiSettingService.upsert({
      chatModel: "gemini-2.5-flash",
      fallbackModel: null,
      location: DEFAULT_PLATFORM_AI_LOCATION,
      capabilities: DEFAULT_PLATFORM_AI_CAPABILITIES,
      enabled: false,
      updatedByUserId: "admin-2",
    })

    expect(invalidateCacheKeysMock).toHaveBeenCalledWith([
      "platform-ai-setting:active",
    ])
  })
})
