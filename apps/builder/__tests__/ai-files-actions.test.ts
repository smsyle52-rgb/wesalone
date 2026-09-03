// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const getActive = vi.fn()
const findOpenAI = vi.fn()
const findGemini = vi.fn()
const findOrFail = vi.fn()
const deleteWhere = vi.fn()
const deleteObject = vi.fn()
const warn = vi.fn()

vi.mock("@chatbotx.io/business", () => ({
  platformAiSettingService: { getActive },
}))

vi.mock("@chatbotx.io/business/errors", () => ({
  ChatbotXException: class extends Error {},
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    query: {
      integrationOpenaiModel: { findFirst: findOpenAI },
      integrationGeminiModel: { findFirst: findGemini },
    },
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn() })),
    })),
  },
  eq: (column: unknown, value: unknown) => ({ column, value }),
  findOrFail,
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  aiFileModel: { id: "AIFile.id" },
}))

vi.mock("@chatbotx.io/filesystem", () => ({
  uploader: { deleteObject },
}))

vi.mock("@chatbotx.io/utils", () => ({
  createId: vi.fn(() => "new-id"),
  zodBigintAsString: vi.fn(() => ({})),
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  AIJobAction: { processAIFile: "processAIFile" },
  aiAgentQueue: { add: vi.fn() },
}))

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(),
}))

vi.mock("@/features/common/schemas", () => ({
  workspaceIdrequestParams: [],
}))

vi.mock("../src/features/ai-files/schemas", () => ({
  createAIFileRequest: {},
}))

vi.mock("@/lib/log", () => ({ logger: { warn } }))

const inertActionClient = {
  bindArgsSchemas: () => ({
    inputSchema: () => ({ action: () => ({}) }),
    action: () => ({}),
  }),
}

vi.mock("@/lib/safe-action", () => ({
  workspaceActionClient: inertActionClient,
  workspaceActionClientAllowExpired: inertActionClient,
}))

const { hasEmbeddingProvider } = await import(
  "../src/features/ai-files/actions/create-ai-file.action"
)
const { deleteAIFile } = await import(
  "../src/features/ai-files/actions/delete-ai-file.action"
)

beforeEach(() => {
  getActive.mockReset().mockResolvedValue(null)
  findOpenAI.mockReset().mockResolvedValue(null)
  findGemini.mockReset().mockResolvedValue(null)
  findOrFail.mockReset().mockResolvedValue({
    id: "file-1",
    workspaceId: "workspace-1",
    path: "workspaces/workspace-1/ai-files/file-1",
  })
  deleteWhere.mockReset().mockResolvedValue(undefined)
  deleteObject.mockReset().mockResolvedValue(undefined)
  warn.mockReset()
})

describe("AI-file embedding provider guard", () => {
  test("accepts the platform Vertex embedding provider", async () => {
    getActive.mockResolvedValue({ embeddingModel: "text-embedding-005" })

    await expect(hasEmbeddingProvider("workspace-1")).resolves.toBe(true)
  })

  test("still accepts a workspace provider when platform AI is disabled", async () => {
    findGemini.mockResolvedValue({ id: "gemini-1" })

    await expect(hasEmbeddingProvider("workspace-1")).resolves.toBe(true)
  })

  test("rejects creation only when no embedding provider exists", async () => {
    await expect(hasEmbeddingProvider("workspace-1")).resolves.toBe(false)
  })
})

describe("AI-file deletion", () => {
  test("deletes the database row and then its storage object", async () => {
    await deleteAIFile({ workspaceId: "workspace-1", id: "file-1" })

    expect(deleteWhere).toHaveBeenCalledOnce()
    expect(deleteObject).toHaveBeenCalledWith(
      "workspaces/workspace-1/ai-files/file-1",
    )
  })

  test("keeps the database deletion successful when storage cleanup fails", async () => {
    deleteObject.mockRejectedValue(new Error("storage unavailable"))

    await expect(
      deleteAIFile({ workspaceId: "workspace-1", id: "file-1" }),
    ).resolves.toBeUndefined()
    expect(deleteWhere).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })

  test("never touches storage when the workspace-scoped file is not found", async () => {
    findOrFail.mockRejectedValue(new Error("not found"))

    await expect(
      deleteAIFile({ workspaceId: "workspace-2", id: "file-1" }),
    ).rejects.toThrow("not found")
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(deleteObject).not.toHaveBeenCalled()
  })
})
