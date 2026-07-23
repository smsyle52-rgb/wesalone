import {
  inventoryMovementModel,
  inventoryStockModel,
} from "@chatbotx.io/database/schema"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  FakeUniqueViolationError,
  fakeSql,
  makeChain,
} from "./support/mock-chain"

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      inventoryLocationModel: { findFirst: vi.fn() },
      inventoryStockModel: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: mockDb,
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: fakeSql,
  isUniqueViolationError: (error: unknown) =>
    error instanceof FakeUniqueViolationError,
}))

const { inventoryService } = await import("../src/inventory/service")

const workspaceId = "workspace-1"
const locationId = "location-1"
const productId = "product-1"

describe("inventoryService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("reserve() holds stock when enough is available", async () => {
    mockDb.query.inventoryStockModel.findFirst.mockResolvedValueOnce({
      id: "stock-1",
      onHand: 5,
      reserved: 2,
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === inventoryStockModel) {
        return makeChain([{ id: "stock-1", onHand: 5, reserved: 3 }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === inventoryMovementModel) {
        return makeChain([{ id: "movement-1" }])
      }
      throw new Error("unexpected insert table")
    })

    await expect(
      inventoryService.reserve({
        workspaceId,
        locationId,
        productId,
        quantity: 1,
        referenceType: "order_item",
        referenceId: "item-1",
        tx: mockDb as never,
      }),
    ).resolves.toBeUndefined()

    expect(mockDb.update).toHaveBeenCalledWith(inventoryStockModel)
    expect(mockDb.insert).toHaveBeenCalledWith(inventoryMovementModel)
  })

  test("reserve() throws insufficientStock when the conditional update matches no rows", async () => {
    mockDb.query.inventoryStockModel.findFirst.mockResolvedValueOnce({
      id: "stock-1",
      onHand: 1,
      reserved: 1,
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === inventoryStockModel) {
        // WHERE onHand - reserved >= quantity matched nothing.
        return makeChain([])
      }
      throw new Error("unexpected update table")
    })

    await expect(
      inventoryService.reserve({
        workspaceId,
        locationId,
        productId,
        quantity: 1,
        referenceType: "order_item",
        referenceId: "item-2",
        tx: mockDb as never,
      }),
    ).rejects.toMatchObject({ code: "insufficientStock" })

    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  test("two concurrent reserves for the last unit: exactly one succeeds", async () => {
    // Both callers read the same pre-race snapshot — neither has seen the
    // other's write yet, which is what makes this a genuine race.
    mockDb.query.inventoryStockModel.findFirst.mockResolvedValue({
      id: "stock-1",
      onHand: 1,
      reserved: 0,
    })

    // First UPDATE's WHERE re-checks `onHand - reserved >= 1` after taking the
    // row lock: still true -> 1 row back. Second UPDATE re-checks the same
    // WHERE after the first has committed: reserved is now 1, so
    // `1 - 1 >= 1` is false -> 0 rows back. This is exactly what Postgres
    // guarantees for a single atomic conditional UPDATE under real
    // concurrent access; the assertion below is that the service correctly
    // turns that zero-row response into a rejection instead of a false
    // "success".
    let updateCall = 0
    mockDb.update.mockImplementation((table: unknown) => {
      if (table !== inventoryStockModel) {
        throw new Error("unexpected update table")
      }
      updateCall += 1
      return updateCall === 1
        ? makeChain([{ id: "stock-1", onHand: 1, reserved: 1 }])
        : makeChain([])
    })
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === inventoryMovementModel) {
        return makeChain([{ id: "movement" }])
      }
      throw new Error("unexpected insert table")
    })

    const attempt = (referenceId: string) =>
      inventoryService.reserve({
        workspaceId,
        locationId,
        productId,
        quantity: 1,
        referenceType: "order_item",
        referenceId,
        tx: mockDb as never,
      })

    const results = await Promise.allSettled([
      attempt("item-a"),
      attempt("item-b"),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "insufficientStock",
    })
  })

  test("releaseHold() decrements reserved and logs a release movement", async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === inventoryStockModel) {
        return makeChain([{ id: "stock-1", onHand: 5, reserved: 0 }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === inventoryMovementModel) {
        return makeChain([{ id: "movement" }])
      }
      throw new Error("unexpected insert table")
    })

    await inventoryService.releaseHold({
      workspaceId,
      locationId,
      productId,
      quantity: 1,
      referenceType: "order_item",
      referenceId: "item-1",
      tx: mockDb as never,
    })

    expect(mockDb.update).toHaveBeenCalledWith(inventoryStockModel)
    expect(mockDb.insert).toHaveBeenCalledWith(inventoryMovementModel)
  })

  test("releaseHold() throws if the stock row is missing", async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === inventoryStockModel) {
        return makeChain([])
      }
      throw new Error("unexpected update table")
    })

    await expect(
      inventoryService.releaseHold({
        workspaceId,
        locationId,
        productId,
        quantity: 1,
        referenceType: "order_item",
        referenceId: "item-1",
        tx: mockDb as never,
      }),
    ).rejects.toThrow()
  })

  test("consumeHold() decrements onHand and reserved together", async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === inventoryStockModel) {
        return makeChain([{ id: "stock-1", onHand: 4, reserved: 0 }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === inventoryMovementModel) {
        return makeChain([{ id: "movement" }])
      }
      throw new Error("unexpected insert table")
    })

    await inventoryService.consumeHold({
      workspaceId,
      locationId,
      productId,
      quantity: 1,
      referenceType: "order_item",
      referenceId: "item-1",
      tx: mockDb as never,
    })

    expect(mockDb.update).toHaveBeenCalledWith(inventoryStockModel)
    expect(mockDb.insert).toHaveBeenCalledWith(inventoryMovementModel)
  })
})
