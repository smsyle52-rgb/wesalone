import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  handoff: vi.fn(),
}))

vi.mock("../src/integration/utils/message", () => ({
  sendMessageWithRender: mocks.send,
}))
vi.mock("../src/trigger/services/handoff-executor.service", () => ({
  handoffExecutorService: { execute: mocks.handoff },
}))
vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))

/** The customer is never told about the merchant's billing. */
const BILLING_WORDS = /point|نقاط|رصيد|balance/i

const { getPointsExhaustedReply, handlePointsExhausted } = await import(
  "../src/integration/handlers/automated-response/points-exhausted"
)

const props = {
  conversation: { id: "conv-1", workspaceId: "ws-1", contactId: "contact-1" },
  contactInbox: { language: null },
  channel: "whatsapp",
  workspaceLanguage: "ar",
} as never

describe("points exhausted", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.send.mockResolvedValue(undefined)
    mocks.handoff.mockResolvedValue(undefined)
  })

  test("answers in the workspace language and never mentions billing", () => {
    const ar = getPointsExhaustedReply("ar")
    const en = getPointsExhaustedReply("en")
    expect(ar).toContain("فريقنا")
    expect(en).toContain("our team")
    for (const text of [ar, en]) {
      expect(text).not.toMatch(BILLING_WORDS)
    }
  })

  test("sends one polite reply and hands the conversation to the team", async () => {
    const result = await handlePointsExhausted(props, {
      provider: "vertex",
      modelId: "gemini-3.7-flash",
    })

    expect(mocks.send).toHaveBeenCalledWith(
      "conv-1",
      getPointsExhaustedReply("ar"),
    )
    expect(mocks.handoff).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        workspaceId: "ws-1",
        contactId: "contact-1",
        reason: "ai_points_exhausted",
        source: "automated_response",
      }),
    )
    expect(result).toMatchObject({ responded: true, usedFallbackText: true })
  })

  test("still counts as answered when the handoff itself fails", async () => {
    mocks.handoff.mockRejectedValueOnce(new Error("db down"))

    await expect(
      handlePointsExhausted(props, { provider: "vertex", modelId: "m" }),
    ).resolves.toMatchObject({ responded: true })
    expect(mocks.send).toHaveBeenCalledOnce()
  })
})
