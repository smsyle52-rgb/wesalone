import {
  paymentModel,
  paymentWebhookEventModel,
} from "@chatbotx.io/database/schema"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  FakeUniqueViolationError,
  makeChain,
  makeErrorChain,
} from "./support/mock-chain"

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: { paymentModel: { findFirst: vi.fn() } },
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

const { mockOrderService } = vi.hoisted(() => ({
  mockOrderService: {
    settlePaid: vi.fn().mockResolvedValue("paid"),
    reopenAfterPaymentFailure: vi.fn(),
    markRefunded: vi.fn(),
  },
}))

const { mockGetPaymentProvider } = vi.hoisted(() => ({
  mockGetPaymentProvider: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: mockDb,
  eq: vi.fn(),
  and: vi.fn(),
  isUniqueViolationError: (error: unknown) =>
    error instanceof FakeUniqueViolationError,
}))
vi.mock("../src/order/service", () => ({ orderService: mockOrderService }))
vi.mock("../src/payment/registry", () => ({
  getPaymentProvider: mockGetPaymentProvider,
}))

const { paymentService } = await import("../src/payment/service")

const baseEvent = {
  providerEventId: "evt_1",
  checkoutReference: "mock_cs_1",
  providerPaymentReference: "pi_1",
  amount: 100,
  currency: "USD",
  status: "paid" as const,
}

const adapterReturning = (verified: unknown) => ({
  name: "mock",
  createCheckoutSession: vi.fn(),
  verifyAndParseWebhook: vi.fn().mockResolvedValue(verified),
})

const throwUnexpected = (label: string) => (): never => {
  throw new Error(`unexpected ${label}`)
}

describe("paymentService.confirmFromWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockDb),
    )
  })

  test("rejects an invalid signature before touching any state", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({ valid: false, reason: "bad signature" }),
    )

    await expect(
      paymentService.confirmFromWebhook({
        provider: "mock",
        rawBody: "{}",
        headers: {},
      }),
    ).rejects.toMatchObject({ code: "invalidWebhookSignature" })

    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockOrderService.settlePaid).not.toHaveBeenCalled()
  })

  test("ignores a replayed webhook event instead of reprocessing it", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({ valid: true, event: baseEvent }),
    )
    mockDb.insert.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeErrorChain(new FakeUniqueViolationError())
        : throwUnexpected("insert table")(),
    )

    const result = await paymentService.confirmFromWebhook({
      provider: "mock",
      rawBody: "{}",
      headers: {},
    })

    expect(result).toEqual({ status: "ignored", reason: "duplicate_event" })
    expect(mockOrderService.settlePaid).not.toHaveBeenCalled()
  })

  test("ignores a webhook whose checkoutReference matches no payment", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({ valid: true, event: baseEvent }),
    )
    mockDb.insert.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("insert table")(),
    )
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce(undefined)

    const result = await paymentService.confirmFromWebhook({
      provider: "mock",
      rawBody: "{}",
      headers: {},
    })

    expect(result).toEqual({ status: "ignored", reason: "payment_not_found" })
    expect(mockOrderService.settlePaid).not.toHaveBeenCalled()
  })

  test("rejects a mismatched amount instead of confirming the payment", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({ valid: true, event: { ...baseEvent, amount: 1 } }),
    )
    mockDb.insert.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("insert table")(),
    )
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
      status: "pending",
      amount: 100,
      currency: "USD",
    })
    mockDb.update.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("update table")(),
    )

    await expect(
      paymentService.confirmFromWebhook({
        provider: "mock",
        rawBody: "{}",
        headers: {},
      }),
    ).rejects.toMatchObject({ code: "paymentMismatch" })
    expect(mockOrderService.settlePaid).not.toHaveBeenCalled()
  })

  test("rejects a mismatched currency instead of confirming the payment", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({
        valid: true,
        event: { ...baseEvent, currency: "EUR" },
      }),
    )
    mockDb.insert.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("insert table")(),
    )
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
      status: "pending",
      amount: 100,
      currency: "USD",
    })
    mockDb.update.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("update table")(),
    )

    await expect(
      paymentService.confirmFromWebhook({
        provider: "mock",
        rawBody: "{}",
        headers: {},
      }),
    ).rejects.toMatchObject({ code: "paymentMismatch" })
    expect(mockOrderService.settlePaid).not.toHaveBeenCalled()
  })

  test("confirms a matching pending payment and marks the order paid", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({ valid: true, event: baseEvent }),
    )
    mockDb.insert.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("insert table")(),
    )
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
      status: "pending",
      amount: 100,
      currency: "USD",
    })
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === paymentWebhookEventModel) {
        return makeChain([{ id: "evt-row-1" }])
      }
      if (table === paymentModel) {
        return makeChain([{ id: "payment-1", status: "paid" }])
      }
      throw new Error("unexpected update table")
    })

    const result = await paymentService.confirmFromWebhook({
      provider: "mock",
      rawBody: "{}",
      headers: {},
    })

    expect(result).toEqual({ status: "ok" })
    expect(mockOrderService.settlePaid).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        workspaceId: "workspace-1",
      }),
    )
  })

  test("does not double-confirm a payment that is no longer pending", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({ valid: true, event: baseEvent }),
    )
    mockDb.insert.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("insert table")(),
    )
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
      status: "paid",
      amount: 100,
      currency: "USD",
    })
    mockDb.update.mockImplementation((table: unknown) =>
      table === paymentWebhookEventModel
        ? makeChain([{ id: "evt-row-1" }])
        : throwUnexpected("update table")(),
    )

    const result = await paymentService.confirmFromWebhook({
      provider: "mock",
      rawBody: "{}",
      headers: {},
    })

    expect(result).toEqual({ status: "ignored", reason: "payment_not_pending" })
    expect(mockOrderService.settlePaid).not.toHaveBeenCalled()
  })

  test("reopens the order and releases its holds after a failed payment", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({
        valid: true,
        event: { ...baseEvent, status: "failed" },
      }),
    )
    mockDb.insert.mockReturnValue(makeChain([{ id: "evt-row-1" }]))
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
      status: "pending",
      amount: 100,
      currency: "USD",
    })
    mockDb.update.mockReturnValue(makeChain([{ id: "updated" }]))

    await expect(
      paymentService.confirmFromWebhook({
        provider: "mock",
        rawBody: "{}",
        headers: {},
      }),
    ).resolves.toEqual({ status: "ok" })

    expect(mockOrderService.reopenAfterPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        workspaceId: "workspace-1",
      }),
    )
  })

  test("records a refund only for an already-paid payment", async () => {
    mockGetPaymentProvider.mockReturnValue(
      adapterReturning({
        valid: true,
        event: { ...baseEvent, status: "refunded" },
      }),
    )
    mockDb.insert.mockReturnValue(makeChain([{ id: "evt-row-1" }]))
    mockDb.query.paymentModel.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      orderId: "order-1",
      workspaceId: "workspace-1",
      status: "paid",
      amount: 100,
      currency: "USD",
    })
    mockDb.update.mockReturnValue(makeChain([{ id: "updated" }]))

    await expect(
      paymentService.confirmFromWebhook({
        provider: "mock",
        rawBody: "{}",
        headers: {},
      }),
    ).resolves.toEqual({ status: "ok" })

    expect(mockOrderService.markRefunded).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        workspaceId: "workspace-1",
      }),
    )
  })
})
