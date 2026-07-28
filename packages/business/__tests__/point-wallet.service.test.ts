import { beforeEach, describe, expect, test, vi } from "vitest"
import { makeChain } from "./support/mock-chain"

const pointWalletModel = { id: "wallet-id", status: "wallet-status" }
const pointGrantModel = {
  id: "grant-id",
  walletId: "grant-wallet-id",
  status: "grant-status",
  startsAt: "grant-starts-at",
  expiresAt: "grant-expires-at",
  remainingMicroPoints: "grant-remaining",
  grantType: "grant-type",
  createdAt: "grant-created-at",
  idempotencyKey: "grant-idempotency-key",
}
const pointLedgerModel = { id: "ledger-id" }
const billableUsageEventModel = {
  walletId: "event-wallet-id",
  status: "event-status",
  reservedMicroPoints: "event-reserved",
}

let walletRow: Record<string, unknown> | null
let grants: Record<string, unknown>[]
let reservedRows: Record<string, unknown>[]

const dbMock = {
  query: {
    pointWalletModel: { findFirst: vi.fn() },
    pointGrantModel: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  select: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(dbMock)),
}

vi.mock("@chatbotx.io/database/client", () => ({
  db: dbMock,
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  gt: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((...args: unknown[]) => args),
  lte: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  billableUsageEventModel,
  pointGrantModel,
  pointLedgerModel,
  pointWalletModel,
}))

vi.mock("../src/keys", () => ({
  env: { TOKENS_PER_POINT: 1000 },
}))

const { pointWalletService } = await import("../src/point-wallet/service")

beforeEach(() => {
  vi.clearAllMocks()
  walletRow = { id: "wallet-1", status: "active" }
  grants = []
  reservedRows = [{ total: "0" }]
  dbMock.query.pointWalletModel.findFirst.mockImplementation(
    async () => walletRow,
  )
  dbMock.query.pointGrantModel.findMany.mockImplementation(async () => grants)
  dbMock.select.mockImplementation(() => makeChain(reservedRows))
})

describe("pointWalletService.getWalletBalance", () => {
  test("keeps a fully exhausted monthly grant visible as consumed usage", async () => {
    grants = [
      {
        id: "grant-1",
        grantType: "monthly_subscription",
        status: "exhausted",
        originalMicroPoints: "1000000000",
        remainingMicroPoints: "0",
        startsAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]

    const balance = await pointWalletService.getWalletBalance("user-1")

    expect(balance.monthlyGrantedPoints).toBe(1000)
    expect(balance.monthlyUsedPoints).toBe(1000)
    expect(balance.monthlyPoints).toBe(0)
    expect(balance.totalAvailablePoints).toBe(0)
  })
})

describe("pointWalletService.createGrant", () => {
  test("rejects non-positive grants before touching the database", async () => {
    await expect(
      pointWalletService.createGrant({
        userId: "user-1",
        grantType: "admin_adjustment",
        points: 0,
        idempotencyKey: "invalid",
      }),
    ).rejects.toMatchObject({ code: "invalidPointGrant" })
    expect(dbMock.transaction).not.toHaveBeenCalled()
  })

  test("returns the winning grant when a concurrent retry wins the unique-key race", async () => {
    const concurrentGrant = {
      id: "grant-winner",
      idempotencyKey: "monthly:user-1:period-1",
    }
    const tx = {
      query: {
        pointWalletModel: {
          findFirst: vi.fn(async () => ({ id: "wallet-1", status: "active" })),
        },
        pointGrantModel: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(concurrentGrant),
        },
      },
      insert: vi.fn(() => {
        const chain = makeChain([])
        chain.onConflictDoNothing = vi.fn(() => chain)
        return chain
      }),
    }

    const result = await pointWalletService.createGrant(
      {
        userId: "user-1",
        grantType: "monthly_subscription",
        points: 1000,
        idempotencyKey: "monthly:user-1:period-1",
      },
      tx as never,
    )

    expect(result).toEqual(concurrentGrant)
    expect(tx.insert).toHaveBeenCalledTimes(1)
  })
})
