import { beforeEach, describe, expect, test, vi } from "vitest"
import { processPendingEmbedding } from "../src/ai-agent/handlers/process-pending-embeddings"

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  findOrFail: vi.fn(),
  loggerError: vi.fn(),
  resolveEmbeddingModel: vi.fn(),
  update: vi.fn(),
  reserve: vi.fn(),
  settleUnits: vi.fn(),
  release: vi.fn(),
}))

// Wesal One meters every embedding against the owner's points.
vi.mock("@chatbotx.io/business", () => ({
  usageMeteringService: {
    reserve: mocks.reserve,
    settleUnits: mocks.settleUnits,
    release: mocks.release,
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: { update: mocks.update },
  eq: vi.fn(),
  findOrFail: mocks.findOrFail,
}))

vi.mock("@chatbotx.io/database/partials", () => ({
  aiEmbeddingStatuses: { enum: { success: "success" } },
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  aiEmbeddingModel: {},
}))

vi.mock("ai", () => ({ embed: mocks.embed }))

vi.mock("../src/ai-agent/lib/embedding-model", () => ({
  resolveEmbeddingModel: mocks.resolveEmbeddingModel,
  embeddingModelKey: () => "google.vertex.embedding:gemini-embedding-001",
  getEmbeddingProviderOptions: async () => undefined,
}))

vi.mock("../src/lib/logger", () => ({
  logger: { error: mocks.loggerError },
}))

describe("processPendingEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findOrFail.mockResolvedValue({
      content: "knowledge chunk",
      id: "embedding-1",
      status: "pending",
      workspaceId: "workspace-1",
    })
  })

  test("keeps the embedding pending and rejects when its provider is unavailable", async () => {
    const providerError = new Error("embedding provider unavailable")
    mocks.resolveEmbeddingModel.mockRejectedValue(providerError)

    await expect(
      processPendingEmbedding({ aiEmbeddingId: "embedding-1" }),
    ).rejects.toThrow(providerError)

    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      providerError,
      "processPendingEmbedding item failed for embeddingId: embedding-1",
    )
  })

  test("reserves per chunk and model, then settles the tokens the provider reported", async () => {
    const reservation = { enabled: true, operationId: "op" }
    mocks.resolveEmbeddingModel.mockResolvedValue({
      model: { provider: "google.vertex.embedding" },
      provider: "platform",
    })
    mocks.reserve.mockResolvedValue(reservation)
    mocks.embed.mockResolvedValue({
      embedding: [0.1, 0.2],
      usage: { tokens: 42 },
    })
    mocks.update.mockReturnValue({
      set: () => ({ where: async () => undefined }),
    })

    await processPendingEmbedding({ aiEmbeddingId: "embedding-1" })

    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        operationId:
          "embedding-document:embedding-1:google.vertex.embedding:gemini-embedding-001",
        category: "embedding_document",
      }),
    )
    expect(mocks.settleUnits).toHaveBeenCalledWith(
      reservation,
      "embedding_document",
      42,
      { tokens: 42 },
    )
    expect(mocks.release).not.toHaveBeenCalled()
  })

  test("releases the reservation when the provider call fails", async () => {
    const reservation = { enabled: true, operationId: "op" }
    const providerError = new Error("vertex 503")
    mocks.resolveEmbeddingModel.mockResolvedValue({
      model: { provider: "google.vertex.embedding" },
      provider: "platform",
    })
    mocks.reserve.mockResolvedValue(reservation)
    mocks.embed.mockRejectedValue(providerError)

    await expect(
      processPendingEmbedding({ aiEmbeddingId: "embedding-1" }),
    ).rejects.toThrow(providerError)

    expect(mocks.release).toHaveBeenCalledWith(reservation, providerError)
    expect(mocks.settleUnits).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
