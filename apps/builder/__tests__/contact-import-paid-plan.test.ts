// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const { planGate, fileFindFirst, queueAdd } = vi.hoisted(() => ({
  // Plain object, not vi.fn(): the preset's clearMocks/restoreMocks would wipe it.
  planGate: { paid: true },
  fileFindFirst: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  inboxService: { find: vi.fn() },
  platformSubscriptionService: {
    assertPaidPlanForWorkspace: () =>
      planGate.paid
        ? Promise.resolve()
        : Promise.reject(new Error("available on paid plans only")),
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    query: {
      fileModel: { findFirst: fileFindFirst },
      importModel: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
  },
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  DefaultJobAction: { runImport: "runImport" },
  defaultQueue: { add: queueAdd },
}))

const { contactImportService } = await import(
  "../src/features/contacts/contact-import.service"
)

const input = {
  fileId: "1234567890",
  inboxId: "100",
  channel: "whatsapp",
} as Parameters<typeof contactImportService.startImport>[1]

describe("contactImportService.startImport — paid-plan gate (public API)", () => {
  beforeEach(() => {
    planGate.paid = true
    fileFindFirst.mockResolvedValue(undefined)
  })

  test("refuses a workspace without a paid plan before touching the file or the queue", async () => {
    planGate.paid = false

    await expect(
      contactImportService.startImport("ws-1", input),
    ).rejects.toThrow("paid plans only")
    expect(fileFindFirst).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  test("lets a paid workspace through to the normal file checks", async () => {
    await expect(
      contactImportService.startImport("ws-1", input),
    ).rejects.toThrow("File not found")
    expect(fileFindFirst).toHaveBeenCalled()
  })
})
