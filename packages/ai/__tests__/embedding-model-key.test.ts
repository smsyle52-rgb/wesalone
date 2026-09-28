import { describe, expect, it, vi } from "vitest"

vi.mock("../src/server/platform-provider", () => ({
  getPlatformEmbeddingModel: vi.fn(),
  getPlatformEmbeddingProviderOptions: vi.fn(),
}))
vi.mock("@chatbotx.io/database/client", () => ({ db: {} }))

const { embeddingModelKey } = await import("../src/server/embedding-model")

describe("embeddingModelKey", () => {
  it("distinguishes models so a re-embed is a new metering operation", () => {
    const azure = { provider: "azure.embedding", modelId: "wesal-embedding" }
    const vertex = {
      provider: "google.vertex.embedding",
      modelId: "gemini-embedding-001",
    }

    expect(embeddingModelKey(azure as never)).toBe(
      "azure.embedding:wesal-embedding",
    )
    expect(embeddingModelKey(vertex as never)).not.toBe(
      embeddingModelKey(azure as never),
    )
  })

  it("is stable for the same model, so a retried job is not billed twice", () => {
    const model = {
      provider: "google.vertex.embedding",
      modelId: "gemini-embedding-001",
    }
    expect(embeddingModelKey(model as never)).toBe(
      embeddingModelKey({ ...model } as never),
    )
  })

  it("passes a plain model string through", () => {
    expect(embeddingModelKey("text-embedding-004")).toBe("text-embedding-004")
  })
})
