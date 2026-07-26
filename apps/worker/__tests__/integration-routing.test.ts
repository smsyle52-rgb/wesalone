import { beforeEach, describe, expect, test, vi } from "vitest"

const { resolveIncomingTextRouting } = await import(
  "../src/integration/routing"
)

const conversation = {
  id: "conversation-1",
  workspaceId: "workspace-1",
  additionalAttributes: {},
}

const challengeConversation = {
  ...conversation,
  additionalAttributes: {
    challenge: { type: "step", data: { stepId: "step-1" } },
  },
}

describe("resolveIncomingTextRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("does not route pending challenges when bot automation is inactive", async () => {
    const isConversationActive = vi.fn(async () => false)

    await expect(
      resolveIncomingTextRouting({
        conversation: challengeConversation as never,
        hasActionableInput: true,
        hasAttachment: false,
        hasText: true,
        isConversationActive,
      }),
    ).resolves.toEqual({ type: "none" })

    expect(isConversationActive).toHaveBeenCalledWith(challengeConversation)
  })

  test("routes pending challenges after bot automation is confirmed active", async () => {
    const isConversationActive = vi.fn(async () => true)

    await expect(
      resolveIncomingTextRouting({
        conversation: challengeConversation as never,
        hasActionableInput: true,
        hasAttachment: false,
        hasText: true,
        isConversationActive,
      }),
    ).resolves.toEqual({
      type: "challenge",
      conversation: challengeConversation,
      challenge: challengeConversation.additionalAttributes.challenge,
    })
  })

  test("routes an attachment-only reply to a pending challenge", async () => {
    const isConversationActive = vi.fn(async () => true)

    await expect(
      resolveIncomingTextRouting({
        conversation: challengeConversation as never,
        // An uploaded image/file/voice carries actionable input but no text.
        hasActionableInput: true,
        hasAttachment: true,
        hasText: false,
        isConversationActive,
      }),
    ).resolves.toEqual({
      type: "challenge",
      conversation: challengeConversation,
      challenge: challengeConversation.additionalAttributes.challenge,
    })
  })

  test("routes automated response only when there is no challenge and bot automation is active", async () => {
    const isConversationActive = vi.fn(async () => true)

    await expect(
      resolveIncomingTextRouting({
        conversation: conversation as never,
        hasActionableInput: true,
        hasAttachment: false,
        hasText: true,
        isConversationActive,
      }),
    ).resolves.toEqual({
      type: "automatedResponse",
      conversation,
    })
  })

  test("routes attachment-only messages to automated response without a challenge", async () => {
    const isConversationActive = vi.fn(async () => true)

    await expect(
      resolveIncomingTextRouting({
        conversation: conversation as never,
        hasActionableInput: true,
        hasAttachment: true,
        hasText: false,
        isConversationActive,
      }),
    ).resolves.toEqual({
      type: "automatedResponse",
      conversation,
    })
  })

  test("skips messages with no actionable input without checking bot automation", async () => {
    const isConversationActive = vi.fn(async () => true)

    await expect(
      resolveIncomingTextRouting({
        conversation: conversation as never,
        hasActionableInput: false,
        hasAttachment: false,
        hasText: false,
        isConversationActive,
      }),
    ).resolves.toEqual({ type: "none" })

    expect(isConversationActive).not.toHaveBeenCalled()
  })
})
