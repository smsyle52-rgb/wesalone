import { beforeEach, describe, expect, test, vi } from "vitest"
import { makeChain } from "./support/mock-chain"

const platformSubscriptionModel = {
  id: "subscription-id",
  userId: "subscription-user-id",
  status: "subscription-status",
  nextGrantAt: "subscription-next-grant-at",
  periodEnd: "subscription-period-end",
}
const userQuotaModel = { userId: "quota-user-id" }

const applyPlanEntitlements = vi.fn(async () => undefined)
vi.mock("../src/user-quota", () => ({
  userQuotaService: { applyPlanEntitlements },
}))

let workspaceRow: Record<string, unknown> | null
let subscriptionRow: Record<string, unknown> | null
let transactionSubscriptionRows: Record<string, unknown>[]
let updateRows: Record<string, unknown>[]
const updateChains: ReturnType<typeof makeChain>[] = []

const dbMock = {
  query: {
    workspaceModel: { findFirst: vi.fn() },
    platformSubscriptionModel: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  update: vi.fn(() => makeChain(updateRows)),
  transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      select: vi.fn(() => {
        const chain = makeChain(transactionSubscriptionRows)
        chain.for = vi.fn().mockResolvedValue(transactionSubscriptionRows)
        return chain
      }),
      update: vi.fn(() => {
        const chain = makeChain([])
        updateChains.push(chain)
        return chain
      }),
    }
    return await fn(tx)
  }),
}

vi.mock("@chatbotx.io/database/client", () => ({
  db: dbMock,
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  platformSubscriptionModel,
  userQuotaModel,
}))

const { addMonthsUtc, currentMonthlyPeriod, platformSubscriptionService } =
  await import("../src/platform-subscription/service")

beforeEach(() => {
  vi.clearAllMocks()
  workspaceRow = { ownerId: "owner-1" }
  subscriptionRow = null
  transactionSubscriptionRows = []
  updateRows = []
  updateChains.length = 0
  dbMock.query.workspaceModel.findFirst.mockImplementation(
    async () => workspaceRow,
  )
  dbMock.query.platformSubscriptionModel.findFirst.mockImplementation(
    async () => subscriptionRow,
  )
})

describe("currentMonthlyPeriod", () => {
  test("skips expired periods after scheduler downtime", () => {
    const result = currentMonthlyPeriod(
      new Date("2026-01-31T00:00:00.000Z"),
      new Date("2026-04-15T00:00:00.000Z"),
    )

    expect(result.periodStart).toEqual(new Date("2026-03-31T00:00:00.000Z"))
    expect(result.periodEnd).toEqual(new Date("2026-04-30T00:00:00.000Z"))
    expect(addMonthsUtc(new Date("2026-01-31T00:00:00.000Z"), 1)).toEqual(
      new Date("2026-02-28T00:00:00.000Z"),
    )
  })

  test("preserves a month-end anchor across successive periods", () => {
    const result = currentMonthlyPeriod(
      new Date("2026-02-28T00:00:00.000Z"),
      new Date("2026-03-31T00:00:00.000Z"),
      31,
    )

    expect(result.periodStart).toEqual(new Date("2026-03-31T00:00:00.000Z"))
    expect(result.periodEnd).toEqual(new Date("2026-04-30T00:00:00.000Z"))
  })
})

describe("platformSubscriptionService paid-plan gate", () => {
  test.each([
    ["no subscription", null, false],
    ["free", { planSlug: "free", status: "active" }, false],
    ["starter active", { planSlug: "starter", status: "active" }, true],
    [
      "growth cancelling at period end",
      { planSlug: "growth", status: "cancel_at_period_end" },
      true,
    ],
    ["starter expired", { planSlug: "starter", status: "expired" }, false],
  ])("%s → paid=%s", async (_label, row, expected) => {
    subscriptionRow = row

    await expect(
      platformSubscriptionService.hasPaidPlanForWorkspace("workspace-1"),
    ).resolves.toBe(expected)
  })

  test("keeps an active paid plan open even when periodEnd has passed", async () => {
    // The lifecycle scheduler that would mark it `expired` is not running, so
    // a stale date alone must not lock a paying merchant out.
    subscriptionRow = {
      planSlug: "growth",
      status: "active",
      periodEnd: new Date("2026-09-02T00:00:00.000Z"),
    }

    await expect(
      platformSubscriptionService.hasPaidPlanForWorkspace("workspace-1"),
    ).resolves.toBe(true)
  })

  test("rejects a free workspace with the paidPlanRequired code", async () => {
    subscriptionRow = { planSlug: "free", status: "active" }

    await expect(
      platformSubscriptionService.assertPaidPlanForWorkspace("workspace-1"),
    ).rejects.toMatchObject({ code: "paidPlanRequired", httpStatusCode: 403 })
  })

  test("lets a paid workspace through", async () => {
    subscriptionRow = { planSlug: "starter", status: "active" }

    await expect(
      platformSubscriptionService.assertPaidPlanForWorkspace("workspace-1"),
    ).resolves.toBeUndefined()
  })
})

describe("platformSubscriptionService cancellation", () => {
  test("schedules a paid subscription for cancellation at period end", async () => {
    subscriptionRow = {
      id: "subscription-1",
      userId: "owner-1",
      source: "manual",
      status: "active",
    }
    updateRows = [
      {
        ...subscriptionRow,
        status: "cancel_at_period_end",
        cancelAtPeriodEnd: true,
      },
    ]

    const result =
      await platformSubscriptionService.scheduleCancellationForWorkspace(
        "workspace-1",
      )

    expect(result.status).toBe("cancel_at_period_end")
  })

  test("downgrades an ended cancellation to a fresh free period", async () => {
    transactionSubscriptionRows = [
      {
        id: "subscription-1",
        userId: "owner-1",
        source: "manual",
        status: "cancel_at_period_end",
        nextGrantAt: new Date("2026-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]

    const changed =
      await platformSubscriptionService.processDueMonthlyGrant("subscription-1")

    expect(changed).toBe(true)
    expect(applyPlanEntitlements).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        plan: expect.objectContaining({ slug: "free" }),
      }),
    )
    const subscriptionUpdate = updateChains.at(-1)
    expect(subscriptionUpdate?.set).toHaveBeenCalledWith(
      expect.objectContaining({
        planSlug: "free",
        source: "free",
        status: "active",
        cancelAtPeriodEnd: false,
      }),
    )
  })
})
