import {
  orderItemModel,
  orderModel,
  paymentModel,
} from "@chatbotx.io/database/schema"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  FakeUniqueViolationError,
  makeChain,
  makeErrorChain,
} from "./support/mock-chain"

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      orderModel: { findFirst: vi.fn(), findMany: vi.fn() },
      orderItemModel: { findFirst: vi.fn(), findMany: vi.fn() },
      productModel: { findFirst: vi.fn() },
      productVariantModel: { findFirst: vi.fn() },
      paymentModel: { findFirst: vi.fn() },
      contactModel: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
    $count: vi.fn(),
  },
}))

const { mockInventoryService } = vi.hoisted(() => ({
  mockInventoryService: {
    ensureDefaultLocation: vi.fn(),
    reserve: vi.fn(),
    releaseHold: vi.fn(),
    consumeHold: vi.fn(),
  },
}))

const { mockGetPaymentProvider } = vi.hoisted(() => ({
  mockGetPaymentProvider: vi.fn(),
}))

const { mockWithBlockedOwnerGuard } = vi.hoisted(() => ({
  mockWithBlockedOwnerGuard: vi.fn(
    async (_workspaceId: string, fn: () => Promise<unknown>) => await fn(),
  ),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: mockDb,
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  relationsFilterToSQL: vi.fn(),
  isUniqueViolationError: (error: unknown) =>
    error instanceof FakeUniqueViolationError,
}))
vi.mock("@chatbotx.io/database/utils", () => ({
  maxLimit: 50,
  defaultPagination: { limit: 20, offset: 0 },
  likeContains: (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`,
  getPaginationWithDefaults: (input: {
    page?: number | null
    perPage?: number | null
  }) => {
    const maxLimit = 50
    const limit = Math.min(maxLimit, input.perPage || 20)
    return { limit, offset: ((input.page || 1) - 1) * limit }
  },
}))
vi.mock("../src/inventory", () => ({ inventoryService: mockInventoryService }))
vi.mock("../src/payment/registry", () => ({
  getPaymentProvider: mockGetPaymentProvider,
}))
vi.mock("../src/workspace-lifecycle/with-blocked-owner-guard", () => ({
  withBlockedOwnerGuard: mockWithBlockedOwnerGuard,
}))

const { orderService } = await import("../src/order/service")

const workspaceId = "workspace-1"
const orderId = "order-1"

describe("orderService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockDb),
    )
  })

  test("getById() denies access to another workspace's order", async () => {
    // A real scoped query (id + workspaceId) simply returns no row when the
    // order belongs to a different workspace — nothing to leak.
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce(undefined)

    await expect(
      orderService.getById({ workspaceId, orderId }),
    ).rejects.toMatchObject({ code: "notFound" })
  })

  test("getById() fetches each item's product/variant and the full payment history for the read-only detail view", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "paid",
      items: [],
      payments: [],
    })

    await orderService.getById({ workspaceId, orderId })

    expect(mockDb.query.orderModel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: orderId, workspaceId },
        with: expect.objectContaining({
          items: expect.objectContaining({
            with: { product: true, productVariant: true },
          }),
          payments: expect.objectContaining({
            orderBy: { createdAt: "desc" },
          }),
        }),
      }),
    )
  })

  test("addItem() prices the line from the looked-up product row, never the client", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "draft",
    })
    mockDb.query.productModel.findFirst.mockResolvedValueOnce({
      id: "product-A",
      workspaceId,
      price: 42,
      taxes: 10,
      discount: 0,
    })
    const insertValues = vi.fn()
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === orderItemModel) {
        return {
          values: (v: unknown) => {
            insertValues(v)
            return makeChain([])
          },
        }
      }
      throw new Error("unexpected insert table")
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([
          { id: orderId, workspaceId, status: "draft", total: 46.2 },
        ])
      }
      throw new Error("unexpected update table")
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([])

    await orderService.addItem({
      workspaceId,
      orderId,
      productId: "product-A",
      quantity: 1,
    })

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: 42, unitTax: 4.2 }),
    )
  })

  test("addItem() never mixes one product's price into another's line", async () => {
    const products: Record<string, { price: number; taxes: number }> = {
      "product-A": { price: 10, taxes: 0 },
      "product-B": { price: 999, taxes: 0 },
    }
    mockDb.query.orderModel.findFirst.mockResolvedValue({
      id: orderId,
      workspaceId,
      status: "draft",
    })
    mockDb.query.productModel.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const product = products[where.id]
        return product
          ? Promise.resolve({
              id: where.id,
              workspaceId,
              ...product,
              discount: 0,
            })
          : Promise.resolve(undefined)
      },
    )
    const insertedLines: unknown[] = []
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === orderItemModel) {
        return {
          values: (v: unknown) => {
            insertedLines.push(v)
            return makeChain([])
          },
        }
      }
      throw new Error("unexpected insert table")
    })
    mockDb.update.mockImplementation((table: unknown) =>
      table === orderModel
        ? makeChain([{ id: orderId, workspaceId, status: "draft" }])
        : (() => {
            throw new Error("unexpected update table")
          })(),
    )
    mockDb.query.orderItemModel.findMany.mockResolvedValue([])

    await orderService.addItem({
      workspaceId,
      orderId,
      productId: "product-A",
      quantity: 1,
    })
    await orderService.addItem({
      workspaceId,
      orderId,
      productId: "product-B",
      quantity: 1,
    })

    expect(insertedLines).toEqual([
      expect.objectContaining({ productId: "product-A", unitPrice: 10 }),
      expect.objectContaining({ productId: "product-B", unitPrice: 999 }),
    ])
  })

  test("addItem() rejects a product that does not belong to this workspace", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "draft",
    })
    // Scoped lookup finds nothing — the product exists, just not here.
    mockDb.query.productModel.findFirst.mockResolvedValueOnce(undefined)

    await expect(
      orderService.addItem({
        workspaceId,
        orderId,
        productId: "someone-elses-product",
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "notFound" })
  })

  test("addItem() rejects a non-positive quantity before touching the database", async () => {
    await expect(
      orderService.addItem({
        workspaceId,
        orderId,
        productId: "product-A",
        quantity: 0,
      }),
    ).rejects.toThrow()
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  test("createDraft() falls back to the existing order when idempotencyKey races on insert", async () => {
    mockDb.query.orderModel.findFirst
      .mockResolvedValueOnce(undefined) // no existing order yet
      .mockResolvedValueOnce({ id: orderId, workspaceId, idempotencyKey: "k1" }) // winner's row, found after the conflict
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeErrorChain(new FakeUniqueViolationError())
      }
      throw new Error("unexpected insert table")
    })

    const result = await orderService.createDraft({
      workspaceId,
      idempotencyKey: "k1",
    })

    expect(result).toMatchObject({ id: orderId, idempotencyKey: "k1" })
  })

  test("createDraft() rejects a contact from another workspace", async () => {
    mockDb.query.contactModel.findFirst.mockResolvedValueOnce(undefined)

    await expect(
      orderService.createDraft({
        workspaceId,
        contactId: "other-workspace-contact",
      }),
    ).rejects.toMatchObject({ code: "notFound" })

    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  test("checkout() reserves stock, opens a payment, and returns a checkout reference", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "draft",
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([
      { id: "item-1", productId: "p1", productVariantId: null, quantity: 2 },
    ])
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([
          {
            id: orderId,
            workspaceId,
            status: "pending_payment",
            total: 100,
            currency: "USD",
          },
        ])
      }
      if (table === orderItemModel) {
        return makeChain([{ id: "item-1" }])
      }
      if (table === paymentModel) {
        return makeChain([{ id: "payment-1" }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === paymentModel) {
        return makeChain([{ id: "payment-1", amount: 100, currency: "USD" }])
      }
      throw new Error("unexpected insert table")
    })
    mockInventoryService.ensureDefaultLocation.mockResolvedValueOnce({
      id: "location-1",
    })
    mockInventoryService.reserve.mockResolvedValue(undefined)
    mockGetPaymentProvider.mockReturnValueOnce({
      name: "mock",
      createCheckoutSession: vi.fn().mockResolvedValue({
        provider: "mock",
        checkoutReference: "mock_cs_1",
      }),
    })

    const result = await orderService.checkout({
      workspaceId,
      orderId,
      provider: "mock",
      idempotencyKey: "checkout-key-1",
    })

    expect(result.checkoutReference).toBe("mock_cs_1")
    expect(mockInventoryService.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1", quantity: 2 }),
    )
  })

  test("checkout() rolls back fully when stock reservation fails partway through", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "draft",
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([
      { id: "item-1", productId: "p1", productVariantId: null, quantity: 1 },
      { id: "item-2", productId: "p2", productVariantId: null, quantity: 999 },
    ])
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([
          {
            id: orderId,
            workspaceId,
            status: "pending_payment",
            total: 10,
            currency: "USD",
          },
        ])
      }
      if (table === orderItemModel) {
        return makeChain([{ id: "item-1" }])
      }
      throw new Error("unexpected update table")
    })
    mockInventoryService.ensureDefaultLocation.mockResolvedValueOnce({
      id: "location-1",
    })
    // Item 1 reserves fine, item 2 has nowhere near enough stock.
    mockInventoryService.reserve
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error("insufficient"), { code: "insufficientStock" }),
      )
    const fakeAdapter = {
      name: "mock",
      createCheckoutSession: vi.fn(),
    }
    mockGetPaymentProvider.mockReturnValue(fakeAdapter)

    await expect(
      orderService.checkout({
        workspaceId,
        orderId,
        provider: "mock",
        idempotencyKey: "checkout-key-2",
      }),
    ).rejects.toMatchObject({ code: "insufficientStock" })

    // The failure must propagate out of the transaction callback uncaught —
    // that is what makes Postgres abort and roll back the whole attempt
    // (including item 1's already-applied reservation). A caught-and-
    // swallowed error here would instead commit a half-reserved order.
    expect(mockDb.insert).not.toHaveBeenCalledWith(paymentModel)
    expect(fakeAdapter.createCheckoutSession).not.toHaveBeenCalled()
  })

  test("checkout() retried with the same idempotencyKey returns the existing payment instead of reserving again", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "pending_payment",
      checkoutIdempotencyKey: "checkout-key-1",
    })
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      checkoutReference: "mock_cs_1",
    })

    const result = await orderService.checkout({
      workspaceId,
      orderId,
      provider: "mock",
      idempotencyKey: "checkout-key-1",
    })

    expect(result.checkoutReference).toBe("mock_cs_1")
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockInventoryService.reserve).not.toHaveBeenCalled()
  })

  test("checkout() rejects an order that is not draft or a matching in-progress checkout", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "paid",
    })

    await expect(
      orderService.checkout({
        workspaceId,
        orderId,
        provider: "mock",
        idempotencyKey: "checkout-key-3",
      }),
    ).rejects.toMatchObject({ code: "orderStateConflict" })
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  test("cancel() releases every unresolved reservation", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "pending_payment",
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([
      {
        id: "item-1",
        productId: "p1",
        productVariantId: null,
        locationId: "location-1",
        quantity: 1,
        reservedAt: new Date(),
        reservationReleasedAt: null,
      },
    ])
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderItemModel) {
        return makeChain([{ id: "item-1" }])
      }
      if (table === orderModel) {
        return makeChain([{ id: orderId, workspaceId, status: "cancelled" }])
      }
      throw new Error("unexpected update table")
    })

    await orderService.cancel({ workspaceId, orderId })

    expect(mockInventoryService.releaseHold).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1", quantity: 1 }),
    )
  })

  test("settlePaid() marks a still-pending order paid and consumes its holds", async () => {
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "pending_payment",
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([
      {
        id: "item-1",
        productId: "p1",
        productVariantId: null,
        locationId: "location-1",
        quantity: 1,
        reservedAt: new Date(),
        reservationReleasedAt: null,
      },
    ])
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([{ id: orderId, workspaceId, status: "paid" }])
      }
      if (table === orderItemModel) {
        return makeChain([{ id: "item-1" }])
      }
      throw new Error("unexpected update table")
    })

    const result = await orderService.settlePaid({
      orderId,
      workspaceId,
      tx: mockDb as never,
    })

    expect(result).toBe("paid")
    expect(mockInventoryService.consumeHold).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1", quantity: 1 }),
    )
    expect(mockInventoryService.releaseHold).not.toHaveBeenCalled()
  })

  test("settlePaid() moves an already-expired order to payment_review instead of paying it", async () => {
    // A webhook can arrive after the order's own expiry sweep already ran —
    // the money must not vanish into a dead order, but it also must not
    // silently flip an expired/cancelled order to "paid" as if nothing
    // happened; payment_review is the human-attention flag for this case.
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "expired",
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([
          { id: orderId, workspaceId, status: "payment_review" },
        ])
      }
      throw new Error("unexpected update table")
    })

    const result = await orderService.settlePaid({
      orderId,
      workspaceId,
      tx: mockDb as never,
    })

    expect(result).toBe("payment_review")
    expect(mockInventoryService.consumeHold).not.toHaveBeenCalled()
  })

  test("reopenAfterPaymentFailure() releases holds and returns the order to draft", async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([{ id: orderId, workspaceId, status: "draft" }])
      }
      if (table === orderItemModel) {
        return makeChain([{ id: "item-1" }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([
      {
        id: "item-1",
        productId: "p1",
        productVariantId: null,
        locationId: "location-1",
        quantity: 1,
        reservedAt: new Date(),
        reservationReleasedAt: null,
      },
    ])

    await orderService.reopenAfterPaymentFailure({
      orderId,
      workspaceId,
      tx: mockDb as never,
    })

    expect(mockInventoryService.releaseHold).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1", quantity: 1 }),
    )
  })

  test("markRefunded() updates the order without touching inventory", async () => {
    // Refund is a financial reversal, not implied restock — the merchant
    // decides separately whether the returned goods go back on the shelf.
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([{ id: orderId, workspaceId, status: "refunded" }])
      }
      throw new Error("unexpected update table")
    })

    await orderService.markRefunded({
      orderId,
      workspaceId,
      tx: mockDb as never,
    })

    expect(mockInventoryService.releaseHold).not.toHaveBeenCalled()
    expect(mockInventoryService.consumeHold).not.toHaveBeenCalled()
  })

  test("checkout() resumes an interrupted attempt without reserving stock twice", async () => {
    // First attempt reserved stock and created a pending Payment, then the
    // provider call itself failed (e.g. network timeout) before a
    // checkoutReference was ever recorded. A retry with the same
    // idempotencyKey must call the provider again, not re-enter the
    // reservation transaction.
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "pending_payment",
      checkoutIdempotencyKey: "checkout-key-1",
    })
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      workspaceId,
      amount: 100,
      currency: "USD",
      status: "pending",
      checkoutReference: null,
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === paymentModel) {
        return makeChain([
          { id: "payment-1", checkoutReference: "mock_cs_resumed" },
        ])
      }
      throw new Error("unexpected update table")
    })
    const fakeAdapter = {
      name: "mock",
      createCheckoutSession: vi.fn().mockResolvedValue({
        provider: "mock",
        checkoutReference: "mock_cs_resumed",
      }),
    }
    mockGetPaymentProvider.mockReturnValue(fakeAdapter)

    const result = await orderService.checkout({
      workspaceId,
      orderId,
      provider: "mock",
      idempotencyKey: "checkout-key-1",
    })

    expect(result.checkoutReference).toBe("mock_cs_resumed")
    expect(fakeAdapter.createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockInventoryService.reserve).not.toHaveBeenCalled()
  })

  test("list() always scopes the query by workspaceId and can filter to payment_review", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([
      { id: "order-a", workspaceId, status: "payment_review" },
    ])
    mockDb.$count.mockResolvedValueOnce(1)

    const result = await orderService.list({
      workspaceId,
      status: "payment_review",
    })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId,
          status: "payment_review",
        }),
      }),
    )
    expect(result.data[0]).toMatchObject({ status: "payment_review" })
    expect(result.pageCount).toBe(1)
  })

  test("list() clamps an oversized perPage to the safe maximum instead of using it as-is", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([])
    mockDb.$count.mockResolvedValueOnce(0)

    await orderService.list({ workspaceId, perPage: 999_999 })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    )
  })

  test("listCursor() always scopes the query by workspaceId and can filter by status", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([
      {
        id: "order-a",
        workspaceId,
        status: "paid",
        contact: null,
        payments: [],
      },
    ])

    await orderService.listCursor({ workspaceId, status: "paid" })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId, status: "paid" }),
        with: expect.objectContaining({ contact: true }),
      }),
    )
  })

  test("listCursor() filters by customer name through the contact relation, never a raw contactId leak", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([])

    await orderService.listCursor({ workspaceId, customerKeyword: "Jane" })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contact: { fullName: { ilike: "%Jane%" } },
        }),
      }),
    )
  })

  test("listCursor() escapes LIKE wildcards in the customer keyword instead of letting them widen the match", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([])

    await orderService.listCursor({ workspaceId, customerKeyword: "50%_off" })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contact: { fullName: { ilike: "%50\\%\\_off%" } },
        }),
      }),
    )
  })

  test("listCursor() builds a keyset (createdAt, id) OR condition from the cursor instead of using OFFSET", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([])
    const after = { createdAt: new Date("2026-01-01T00:00:00Z"), id: "order-9" }

    await orderService.listCursor({ workspaceId, after })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }),
      }),
    )
  })

  test("listCursor() reports hasMore and trims the extra probe row instead of returning it", async () => {
    // Requests limit N by fetching N+1 to detect whether another page exists,
    // without a separate COUNT(*) query.
    mockDb.query.orderModel.findMany.mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, i) => ({
        id: `order-${i}`,
        workspaceId,
        contact: null,
        payments: [],
      })),
    )

    const result = await orderService.listCursor({ workspaceId, perPage: 2 })

    expect(result.hasMore).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  test("listCursor() reports hasMore=false when fewer rows than the limit come back", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([
      { id: "order-a", workspaceId, contact: null, payments: [] },
    ])

    const result = await orderService.listCursor({ workspaceId, perPage: 2 })

    expect(result.hasMore).toBe(false)
    expect(result.data).toHaveLength(1)
  })

  test("listCursor() clamps an oversized perPage to the safe maximum instead of using it as-is", async () => {
    mockDb.query.orderModel.findMany.mockResolvedValueOnce([])

    await orderService.listCursor({ workspaceId, perPage: 999_999 })

    expect(mockDb.query.orderModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 51 }),
    )
  })

  test("expireStalePendingOrders() expires a stale order and releases its hold exactly once", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([{ id: orderId, workspaceId, status: "pending_payment" }]),
    )
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([{ id: orderId, workspaceId, status: "expired" }])
      }
      if (table === orderItemModel) {
        return makeChain([{ id: "item-1" }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([
      {
        id: "item-1",
        productId: "p1",
        productVariantId: null,
        locationId: "location-1",
        quantity: 1,
        reservedAt: new Date(),
        reservationReleasedAt: null,
      },
    ])

    const result = await orderService.expireStalePendingOrders({})

    expect(result).toEqual({ expiredCount: 1, processedCount: 1 })
    expect(mockInventoryService.releaseHold).toHaveBeenCalledTimes(1)
    expect(mockWithBlockedOwnerGuard).toHaveBeenCalledWith(
      workspaceId,
      expect.any(Function),
    )
  })

  test("expireStalePendingOrders() re-run over the same order does not release its hold again", async () => {
    // Simulates the worker tick re-running (retry, or a second replica that
    // read the same stale batch before the first replica's UPDATE landed):
    // the conditional UPDATE now matches zero rows because the order is no
    // longer pending_payment.
    mockDb.select.mockReturnValueOnce(
      makeChain([{ id: orderId, workspaceId, status: "pending_payment" }]),
    )
    mockDb.update.mockImplementation((table: unknown) =>
      table === orderModel
        ? makeChain([])
        : (() => {
            throw new Error("unexpected update table")
          })(),
    )

    const result = await orderService.expireStalePendingOrders({})

    expect(result).toEqual({ expiredCount: 0, processedCount: 1 })
    expect(mockInventoryService.releaseHold).not.toHaveBeenCalled()
  })

  test("two concurrent expiry passes over the same order only expire it once", async () => {
    const staleOrder = { id: orderId, workspaceId, status: "pending_payment" }
    mockDb.select.mockReturnValue(makeChain([staleOrder]))
    mockDb.query.orderItemModel.findMany.mockResolvedValue([])
    let updateCall = 0
    mockDb.update.mockImplementation((table: unknown) => {
      if (table !== orderModel) {
        throw new Error("unexpected update table")
      }
      updateCall += 1
      return updateCall === 1
        ? makeChain([{ id: orderId, workspaceId, status: "expired" }])
        : makeChain([])
    })

    const [first, second] = await Promise.all([
      orderService.expireStalePendingOrders({}),
      orderService.expireStalePendingOrders({}),
    ])

    const totalExpired = first.expiredCount + second.expiredCount
    expect(totalExpired).toBe(1)
  })

  test("a non-expired order (expiresAt still in the future) is left untouched", async () => {
    // The batch query's own WHERE (status = pending_payment AND expiresAt <=
    // now) is what keeps a live order out of the batch entirely — an empty
    // result here means the service correctly does nothing.
    mockDb.select.mockReturnValueOnce(makeChain([]))

    const result = await orderService.expireStalePendingOrders({})

    expect(result).toEqual({ expiredCount: 0, processedCount: 0 })
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(mockInventoryService.releaseHold).not.toHaveBeenCalled()
  })

  test("a late paid webhook for an order the expiry sweep already closed lands in payment_review, not paid", async () => {
    // First: the sweep wins the race and expires the order.
    mockDb.select.mockReturnValueOnce(
      makeChain([{ id: orderId, workspaceId, status: "pending_payment" }]),
    )
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([{ id: orderId, workspaceId, status: "expired" }])
      }
      throw new Error("unexpected update table")
    })
    mockDb.query.orderItemModel.findMany.mockResolvedValueOnce([])

    const sweep = await orderService.expireStalePendingOrders({})
    expect(sweep.expiredCount).toBe(1)

    // Then: the late webhook's settlePaid call finds the order already
    // resolved away from pending_payment and must not silently mark it paid.
    mockDb.query.orderModel.findFirst.mockResolvedValueOnce({
      id: orderId,
      workspaceId,
      status: "expired",
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orderModel) {
        return makeChain([
          { id: orderId, workspaceId, status: "payment_review" },
        ])
      }
      throw new Error("unexpected update table")
    })

    const settled = await orderService.settlePaid({
      orderId,
      workspaceId,
      tx: mockDb as never,
    })

    expect(settled).toBe("payment_review")
    expect(mockInventoryService.consumeHold).not.toHaveBeenCalled()
  })
})
