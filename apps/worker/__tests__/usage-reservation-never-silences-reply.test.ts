import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  loggerError: vi.fn(),
}))

class InsufficientPointsError extends Error {
  available: number
  required: number
  constructor(available: number, required: number) {
    super("Insufficient points")
    this.available = available
    this.required = required
  }
}

vi.mock("@chatbotx.io/business", () => ({
  InsufficientPointsError,
  usageMeteringService: { reserve: mocks.reserve },
}))
vi.mock("../src/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}))

const { reserveUsageOrUnmetered } = await import(
  "../src/integration/handlers/shared/reserve-usage"
)

const options = {
  workspaceId: "ws-1",
  operationId: "auto-reply:msg-1:gemini:gemini-3.6-flash",
  category: "language" as const,
}
const context = {
  provider: "gemini",
  modelId: "gemini-3.6-flash",
  conversationId: "conv-1",
}

describe("reserveUsageOrUnmetered", () => {
  beforeEach(() => {
    mocks.reserve.mockReset()
    mocks.loggerError.mockReset()
  })

  test("returns the reservation when metering succeeds", async () => {
    const reservation = { enabled: true, operationId: options.operationId }
    mocks.reserve.mockResolvedValue(reservation)

    await expect(reserveUsageOrUnmetered(options, context)).resolves.toBe(
      reservation,
    )
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })

  // The whole point of the helper: a billing outage must never become a
  // customer who got no answer.
  test.each([
    ["a database error", new Error("timeout exceeded when trying to connect")],
    ["an inactive wallet", new Error("Point wallet is not active")],
    [
      "a retried job hitting the duplicate guard",
      new Error("This AI operation is already running"),
    ],
  ])("replies unmetered when reserve fails with %s", async (_label, error) => {
    mocks.reserve.mockRejectedValue(error)

    await expect(
      reserveUsageOrUnmetered(options, context),
    ).resolves.toBeUndefined()
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    expect(mocks.loggerError.mock.calls[0][1]).toContain("replying unmetered")
  })

  // The one case that must still stop the call — but never invisibly.
  test("rethrows and logs when the workspace is out of points", async () => {
    mocks.reserve.mockRejectedValue(new InsufficientPointsError(0, 7))

    await expect(
      reserveUsageOrUnmetered(options, context),
    ).rejects.toBeInstanceOf(InsufficientPointsError)
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    expect(mocks.loggerError.mock.calls[0][1]).toContain("out of points")
  })
})
