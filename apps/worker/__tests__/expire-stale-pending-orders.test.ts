import { beforeEach, describe, expect, test, vi } from "vitest"

const expireStalePendingOrders = vi.fn()
const runExclusive = vi.fn(async ({ fn }: { fn: () => Promise<unknown> }) =>
  fn(),
)
const info = vi.fn()

vi.mock("@chatbotx.io/business", () => ({
  orderService: { expireStalePendingOrders },
}))
vi.mock("@chatbotx.io/redis", () => ({ distributedLock: { runExclusive } }))
vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ info }),
}))

const { expireStalePendingOrders: runHandler } = await import(
  "../src/schedule/handlers/expire-stale-pending-orders"
)

beforeEach(() => {
  expireStalePendingOrders.mockReset()
  runExclusive.mockClear()
  info.mockReset()
  expireStalePendingOrders.mockResolvedValue({
    expiredCount: 0,
    processedCount: 0,
  })
})

describe("expireStalePendingOrders (worker handler)", () => {
  test("runs under a distributed lock shorter than the 1-minute cron cadence", async () => {
    await runHandler()

    expect(runExclusive).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "schedule:expire-stale-pending-orders",
        timeoutInSeconds: 45,
      }),
    )
    expect(expireStalePendingOrders).toHaveBeenCalledWith({ batchSize: 100 })
  })

  test("logs only when the batch actually processed something", async () => {
    expireStalePendingOrders.mockResolvedValue({
      expiredCount: 3,
      processedCount: 5,
    })

    await runHandler()

    expect(info).toHaveBeenCalledWith(
      { expiredCount: 3, processedCount: 5 },
      "expireStalePendingOrders: batch processed",
    )
  })

  test("stays quiet when there was nothing to process", async () => {
    await runHandler()

    expect(info).not.toHaveBeenCalled()
  })
})
