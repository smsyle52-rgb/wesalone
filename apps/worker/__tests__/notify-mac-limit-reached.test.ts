import { beforeEach, describe, expect, test, vi } from "vitest"

const listOwnersNeedingMacBlockedNotice = vi.fn()
const markMacBlockedNotified = vi.fn()
const findNotifiableOwner = vi.fn()
const sendUsageLimitReached = vi.fn()
const warn = vi.fn()
const info = vi.fn()

vi.mock("@chatbotx.io/business", () => ({
  userQuotaService: {
    listOwnersNeedingMacBlockedNotice,
    markMacBlockedNotified,
  },
  workspaceService: { findNotifiableOwner },
}))
vi.mock("@chatbotx.io/mail", () => ({ sendUsageLimitReached }))
vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ warn, info }),
}))
vi.mock("@chatbotx.io/redis", () => ({
  distributedLock: {
    runExclusive: ({ fn }: { fn: () => Promise<void> }) => fn(),
  },
}))

const { notifyMacLimitReached } = await import(
  "../src/schedule/handlers/notify-mac-limit-reached"
)

const OWNER = { userId: "u1", macLimit: 1000, planName: "Starter" }

beforeEach(() => {
  vi.clearAllMocks()
  listOwnersNeedingMacBlockedNotice.mockResolvedValue([OWNER])
  markMacBlockedNotified.mockResolvedValue(undefined)
  findNotifiableOwner.mockResolvedValue({
    email: "merchant@example.com",
    name: "التاجر",
    workspaceName: "برستيج",
  })
  sendUsageLimitReached.mockResolvedValue(undefined)
})

describe("notifyMacLimitReached", () => {
  test("emails the owner and marks the notice sent", async () => {
    await notifyMacLimitReached()

    expect(sendUsageLimitReached).toHaveBeenCalledWith(
      "merchant@example.com",
      expect.objectContaining({ workspaceName: "برستيج", macLimit: 1000 }),
    )
    expect(markMacBlockedNotified).toHaveBeenCalledWith("u1")
  })

  test("does not mark as notified when the send fails, so the next sweep retries", async () => {
    sendUsageLimitReached.mockRejectedValueOnce(new Error("smtp down"))

    await notifyMacLimitReached()

    expect(markMacBlockedNotified).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  test("one failing owner does not stop the rest of the sweep", async () => {
    listOwnersNeedingMacBlockedNotice.mockResolvedValue([
      OWNER,
      { userId: "u2", macLimit: 500, planName: "Starter" },
    ])
    sendUsageLimitReached.mockRejectedValueOnce(new Error("smtp down"))

    await notifyMacLimitReached()

    expect(sendUsageLimitReached).toHaveBeenCalledTimes(2)
    expect(markMacBlockedNotified).toHaveBeenCalledExactlyOnceWith("u2")
  })

  test("stamps owners with no reachable address so they are not rescanned all period", async () => {
    findNotifiableOwner.mockResolvedValue(null)

    await notifyMacLimitReached()

    expect(sendUsageLimitReached).not.toHaveBeenCalled()
    expect(markMacBlockedNotified).toHaveBeenCalledWith("u1")
  })

  test("sends nothing when no owner is over the limit", async () => {
    listOwnersNeedingMacBlockedNotice.mockResolvedValue([])

    await notifyMacLimitReached()

    expect(sendUsageLimitReached).not.toHaveBeenCalled()
    expect(markMacBlockedNotified).not.toHaveBeenCalled()
  })
})
