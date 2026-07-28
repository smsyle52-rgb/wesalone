import { beforeEach, describe, expect, test, vi } from "vitest"
import { makeChain } from "./support/mock-chain"

const billableUsageEventModel = {
  operationId: "operation-id",
  id: "event-id",
  category: "event-category",
  createdAt: "event-created-at",
  settledMicroPoints: "event-settled-micro-points",
  status: "event-status",
  usage: "event-usage",
  workspaceId: "event-workspace-id",
}
const pointGrantModel = {}
const pointWalletModel = { id: "wallet-id" }

let eventRows: Record<string, unknown>[]
let summaryRows: Record<string, unknown>[]
let lastSelectChain: ReturnType<typeof makeChain> | undefined

const dbMock = {
  select: vi.fn(() => {
    const chain = makeChain(summaryRows)
    chain.groupBy = vi.fn(() => chain)
    chain.orderBy = vi.fn(() => chain)
    return chain
  }),
  transaction: vi.fn((fn: (tx: unknown) => unknown) => {
    const tx = {
      select: vi.fn(() => {
        lastSelectChain = makeChain(eventRows)
        lastSelectChain.for = vi.fn().mockResolvedValue(eventRows)
        return lastSelectChain
      }),
    }
    return fn(tx)
  }),
}

vi.mock("@chatbotx.io/database/client", () => ({
  db: dbMock,
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  gt: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((...args: unknown[]) => args),
  lte: vi.fn((...args: unknown[]) => args),
  ne: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  billableUsageEventModel,
  pointGrantModel,
  pointWalletModel,
}))

vi.mock("../src/keys", () => ({
  env: {
    AI_POINTS_ENFORCEMENT_MODE: "shadow",
    AI_POINTS_RESERVATION_TTL_MINUTES: 30,
  },
}))

vi.mock("../src/point-wallet/service", () => ({
  MICRO_POINTS_PER_POINT: 1_000_000n,
  InsufficientPointsError: class extends Error {},
  pointWalletService: { debitMicroPointsFromWallet: vi.fn() },
  toVisiblePoints: vi.fn(
    (microPoints: bigint) => Number(microPoints) / 1_000_000,
  ),
}))

const { usageMeteringService } = await import("../src/usage-metering/service")

beforeEach(() => {
  vi.clearAllMocks()
  eventRows = []
  summaryRows = []
  lastSelectChain = undefined
})

describe("usageMeteringService settlement", () => {
  test("locks the usage event and treats a released retry as a no-op", async () => {
    eventRows = [
      {
        id: "event-1",
        operationId: "operation-1",
        status: "released",
      },
    ]

    await usageMeteringService.settleLanguage(
      { enabled: true, operationId: "operation-1", eventId: "event-1" },
      { inputTokens: 10, outputTokens: 2 },
    )

    expect(lastSelectChain?.for).toHaveBeenCalledWith("update")
  })
})

describe("usageMeteringService.getUsageSummary", () => {
  test("shows web-search charges separately without double-counting language", async () => {
    summaryRows = [
      {
        category: "language",
        microPoints: "12000000",
        operations: 1,
        webSearchMicroPoints: "10000000",
        webSearches: 2,
      },
    ]

    const summary = await usageMeteringService.getUsageSummary("workspace-1")

    expect(summary).toEqual([
      { category: "language", points: 2, operations: 1 },
      { category: "web_search", points: 10, operations: 2 },
    ])
  })
})
