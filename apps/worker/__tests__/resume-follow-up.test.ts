import { beforeEach, describe, expect, test, vi } from "vitest"

const { contactInboxService, integrationQueueAdd, smartDelayService } =
  vi.hoisted(() => ({
    contactInboxService: {
      hasIncomingMessageSince: vi.fn(),
      // A follow-up now also stops when somebody already answered.
      hasHumanReplySince: vi.fn(),
    },
    integrationQueueAdd: vi.fn(),
    smartDelayService: {
      claimForRun: vi.fn(),
      findById: vi.fn(),
    },
  }))

vi.mock("@chatbotx.io/business/contact-inbox", () => ({ contactInboxService }))

vi.mock("@chatbotx.io/business/smart-delay", () => ({ smartDelayService }))

vi.mock("@chatbotx.io/worker-config", () => ({
  IntegrationJobAction: {
    resumeFollowUp: "resumeFollowUp",
    resumeWait: "resumeWait",
    sendFlow: "sendFlow",
  },
  integrationQueue: {
    add: integrationQueueAdd,
  },
}))

vi.mock("../src/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const { runFollowUpResume } = await import(
  "../src/integration/handlers/follow-up"
)

const followUpRow = {
  id: "smart-delay-1",
  workspaceId: "workspace-1",
  flowId: "flow-1",
  flowVersionId: "flow-version-1",
  contactInboxId: "contact-inbox-1",
  conversationId: "conversation-1",
  nodeId: "next-node",
  stepId: "step-1",
  metadata: null,
  type: "followUp",
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
  triggerAt: new Date("2026-07-16T00:01:00.000Z"),
  status: "scheduled",
}

describe("runFollowUpResume", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-16T00:01:00.000Z"))
    smartDelayService.findById.mockResolvedValue(followUpRow)
    smartDelayService.claimForRun.mockResolvedValue(true)
    contactInboxService.hasIncomingMessageSince.mockResolvedValue(false)
    contactInboxService.hasHumanReplySince.mockResolvedValue(false)
    integrationQueueAdd.mockResolvedValue(undefined)
  })

  test("cancels the follow-up without sending when the contact replied", async () => {
    contactInboxService.hasIncomingMessageSince.mockResolvedValueOnce(true)

    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(contactInboxService.hasIncomingMessageSince).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      contactInboxId: "contact-inbox-1",
      since: followUpRow.createdAt,
    })
    expect(smartDelayService.claimForRun).toHaveBeenCalledWith({
      id: "smart-delay-1",
      to: "canceled",
    })
    expect(integrationQueueAdd).not.toHaveBeenCalled()
  })

  // The merchant answering from their own WhatsApp app reaches us as a
  // coexistence echo — an OUTGOING message, not an incoming one — so asking
  // only "did the customer write again?" sent the canned nudge on top of a real
  // human reply. Measured on 3 Sep 2026: 205 contact inboxes whose newest
  // outgoing message was human, 188 of them with the tracking column behind it.
  test("cancels the follow-up when a human already answered", async () => {
    contactInboxService.hasHumanReplySince.mockResolvedValueOnce(true)

    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(contactInboxService.hasHumanReplySince).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      contactInboxId: "contact-inbox-1",
      since: followUpRow.createdAt,
    })
    expect(smartDelayService.claimForRun).toHaveBeenCalledWith({
      id: "smart-delay-1",
      to: "canceled",
    })
    expect(integrationQueueAdd).not.toHaveBeenCalled()
  })

  test("continues the flow when the contact stayed silent", async () => {
    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(integrationQueueAdd).toHaveBeenCalledWith("sendFlow", {
      type: "sendFlow",
      data: {
        conversationId: "conversation-1",
        contactInboxId: "contact-inbox-1",
        flowId: "flow-1",
        flowVersionId: "flow-version-1",
        nodeId: "next-node",
      },
    })
    expect(smartDelayService.claimForRun).toHaveBeenCalledWith({
      id: "smart-delay-1",
      to: "completed",
    })
  })

  test("preserves broadcast metadata when continuing the flow", async () => {
    smartDelayService.findById.mockResolvedValueOnce({
      ...followUpRow,
      metadata: {
        type: "broadcast",
        broadcastId: "broadcast-1",
        contactInboxId: "contact-inbox-1",
      },
    })

    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(integrationQueueAdd).toHaveBeenCalledWith("sendFlow", {
      type: "sendFlow",
      data: expect.objectContaining({
        metadata: {
          type: "broadcast",
          broadcastId: "broadcast-1",
          contactInboxId: "contact-inbox-1",
        },
      }),
    })
  })

  test("does not enqueue when another worker already claimed the row", async () => {
    smartDelayService.claimForRun.mockResolvedValueOnce(false)

    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(integrationQueueAdd).not.toHaveBeenCalled()
  })

  test("does not touch rows scheduled for the future", async () => {
    smartDelayService.findById.mockResolvedValueOnce({
      ...followUpRow,
      triggerAt: new Date("2026-07-16T00:02:00.000Z"),
    })

    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(contactInboxService.hasIncomingMessageSince).not.toHaveBeenCalled()
    expect(smartDelayService.claimForRun).not.toHaveBeenCalled()
    expect(integrationQueueAdd).not.toHaveBeenCalled()
  })

  test.each([
    null,
    { ...followUpRow, type: "waitNode" },
    { ...followUpRow, status: "completed" },
    { ...followUpRow, nodeId: null },
  ])("no-ops for non-resumable row %#", async (row) => {
    smartDelayService.findById.mockResolvedValueOnce(row)

    await runFollowUpResume({ smartDelayId: "smart-delay-1" })

    expect(contactInboxService.hasIncomingMessageSince).not.toHaveBeenCalled()
    expect(integrationQueueAdd).not.toHaveBeenCalled()
    expect(smartDelayService.claimForRun).not.toHaveBeenCalled()
  })
})
