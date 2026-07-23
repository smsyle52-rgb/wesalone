import {
  and,
  type DatabaseClient,
  db,
  eq,
  isNull,
  isUniqueViolationError,
  lte,
  relationsFilterToSQL,
} from "@chatbotx.io/database/client"
import type { OrderStatusType } from "@chatbotx.io/database/partials"
import {
  orderItemModel,
  orderModel,
  paymentModel,
} from "@chatbotx.io/database/schema"
import type {
  ContactModel,
  OrderItemModel,
  OrderModel,
  PaymentModel,
  ProductModel,
  ProductVariantModel,
} from "@chatbotx.io/database/types"
import {
  defaultPagination,
  getPaginationWithDefaults,
  likeContains,
  maxLimit,
} from "@chatbotx.io/database/utils"
import { createId } from "@chatbotx.io/utils"
import { BaseService } from "../base.service"
import {
  ChatbotXException,
  notFoundException,
  orderStateConflictException,
} from "../errors"
import { inventoryService } from "../inventory"
import type { PaymentProviderAdapter } from "../payment/provider"
import { getPaymentProvider } from "../payment/registry"
import { withBlockedOwnerGuard } from "../workspace-lifecycle/with-blocked-owner-guard"

const CHECKOUT_RESERVATION_TTL_MINUTES = 15
const EXPIRE_BATCH_SIZE = 100

const round2 = (value: number) => Math.round(value * 100) / 100

const computeLinePricing = (props: {
  price: number
  taxesPercent: number
  discountPercent: number
  quantity: number
}) => {
  const { price, taxesPercent, discountPercent, quantity } = props
  const unitPrice = round2(price * (1 - discountPercent / 100))
  const unitTax = round2(unitPrice * (taxesPercent / 100))
  const lineTotal = round2((unitPrice + unitTax) * quantity)
  return { unitPrice, unitTax, lineTotal }
}

const recomputeOrderTotals = (items: OrderItemModel[]) => ({
  subtotal: round2(
    items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  ),
  taxTotal: round2(
    items.reduce((sum, item) => sum + item.unitTax * item.quantity, 0),
  ),
  discountTotal: 0,
  total: round2(
    items.reduce(
      (sum, item) => sum + (item.unitPrice + item.unitTax) * item.quantity,
      0,
    ),
  ),
})

type OrderWithItems = OrderModel & { items: OrderItemModel[] }

// getById() alone fetches these nested relations (product/variant names for
// the read-only order detail UI, full payment history); addItem()/removeItem()
// (via recalculateAndReturn) only ever touch draft orders and don't fetch any
// of this, so this stays a separate, wider type rather than changing
// OrderWithItems for every caller.
type OrderDetail = OrderModel & {
  items: (OrderItemModel & {
    product: ProductModel
    productVariant: ProductVariantModel | null
  })[]
  payments: PaymentModel[]
}

type OrderListItem = OrderModel & {
  contact: Pick<ContactModel, "id" | "fullName" | "avatar"> | null
  payments: PaymentModel[]
}

type OrderCursorPosition = { createdAt: Date; id: string }

class OrderService extends BaseService {
  async createDraft(props: {
    workspaceId: string
    contactId?: string | null
    idempotencyKey?: string
    tx?: DatabaseClient
  }): Promise<OrderModel> {
    const { workspaceId, contactId, idempotencyKey, tx = db } = props

    if (contactId) {
      const contact = await tx.query.contactModel.findFirst({
        where: { id: contactId, workspaceId },
        columns: { id: true },
      })
      if (!contact) {
        throw notFoundException("Contact not found")
      }
    }

    if (idempotencyKey) {
      const existing = await tx.query.orderModel.findFirst({
        where: { workspaceId, idempotencyKey },
      })
      if (existing) {
        return existing
      }
    }

    try {
      const [order] = await tx
        .insert(orderModel)
        .values({
          id: createId(),
          workspaceId,
          contactId: contactId ?? null,
          status: "draft",
          idempotencyKey: idempotencyKey ?? null,
        })
        .returning()
      if (!order) {
        throw new ChatbotXException("Failed to create draft order")
      }
      return order
    } catch (error) {
      if (idempotencyKey && isUniqueViolationError(error)) {
        const existing = await tx.query.orderModel.findFirst({
          where: { workspaceId, idempotencyKey },
        })
        if (existing) {
          return existing
        }
      }
      throw error
    }
  }

  async getById(props: {
    workspaceId: string
    orderId: string
  }): Promise<OrderDetail> {
    const { workspaceId, orderId } = props
    const order = await db.query.orderModel.findFirst({
      where: { id: orderId, workspaceId },
      with: {
        items: { with: { product: true, productVariant: true } },
        payments: { orderBy: { createdAt: "desc" } },
      },
    })
    if (!order) {
      throw notFoundException("Order not found")
    }
    return order as OrderDetail
  }

  async list(props: {
    workspaceId: string
    status?: OrderStatusType
    contactId?: string
    page?: number | null
    perPage?: number | null
  }): Promise<{ data: OrderModel[]; pageCount: number }> {
    const { workspaceId, status, contactId, page, perPage } = props
    const where = {
      workspaceId,
      status: status ?? undefined,
      contactId: contactId ?? undefined,
    }
    const pagination = getPaginationWithDefaults({ page, perPage })

    const [data, total] = await Promise.all([
      db.query.orderModel.findMany({
        where,
        orderBy: { createdAt: "desc" },
        limit: pagination.limit,
        offset: pagination.offset,
      }),
      db.$count(orderModel, relationsFilterToSQL(orderModel, where)),
    ])

    const pageCount = pagination.limit ? Math.ceil(total / pagination.limit) : 1
    return { data, pageCount }
  }

  /**
   * Read-only admin listing for the Orders UI table. Kept separate from
   * `list()` (page/offset-based, already relied on elsewhere) rather than
   * changing its shape: this uses keyset pagination on (createdAt, id) so the
   * table stays cheap as the Order table grows, and joins the contact so the
   * UI can show a customer name without an extra round trip.
   */
  async listCursor(props: {
    workspaceId: string
    status?: OrderStatusType
    customerKeyword?: string
    after?: OrderCursorPosition
    perPage?: number | null
  }): Promise<{ data: OrderListItem[]; hasMore: boolean }> {
    const { workspaceId, status, customerKeyword, after, perPage } = props
    const limit = Math.min(maxLimit, perPage || defaultPagination.limit)

    const where: Record<string, unknown> = {
      workspaceId,
      status: status ?? undefined,
    }
    if (customerKeyword) {
      where.contact = { fullName: { ilike: likeContains(customerKeyword) } }
    }
    if (after) {
      where.OR = [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ]
    }

    const rows = await db.query.orderModel.findMany({
      where,
      orderBy: { createdAt: "desc", id: "desc" },
      limit: limit + 1,
      with: {
        contact: true,
        // Latest attempt only — an order can have more than one Payment row
        // across retries; Order.status stays the authoritative lifecycle
        // state, this is just "what happened with the most recent attempt".
        payments: { orderBy: { createdAt: "desc" }, limit: 1 },
      },
    })

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    return { data: data as OrderListItem[], hasMore }
  }

  async addItem(props: {
    workspaceId: string
    orderId: string
    productId: string
    productVariantId?: string | null
    quantity: number
  }): Promise<OrderWithItems> {
    const { workspaceId, orderId, productId, productVariantId, quantity } =
      props
    if (quantity <= 0) {
      throw new ChatbotXException("Quantity must be positive")
    }

    return await db.transaction(async (tx) => {
      await this.findDraftOrThrow({ workspaceId, orderId, tx })

      // Scoping this lookup by workspaceId is what makes it impossible to
      // borrow another workspace's product/price — never trust a client-sent
      // price, always re-read it from the row scoped to this workspace.
      const product = await tx.query.productModel.findFirst({
        where: { id: productId, workspaceId },
      })
      if (!product) {
        throw notFoundException("Product not found")
      }

      let unitBasePrice = product.price
      if (productVariantId) {
        const variant = await tx.query.productVariantModel.findFirst({
          where: { id: productVariantId, productId },
        })
        if (!variant) {
          throw notFoundException("Product variant not found")
        }
        unitBasePrice = variant.price
      }

      const { unitPrice, unitTax, lineTotal } = computeLinePricing({
        price: unitBasePrice,
        taxesPercent: product.taxes,
        discountPercent: product.discount,
        quantity,
      })

      await tx.insert(orderItemModel).values({
        id: createId(),
        workspaceId,
        orderId,
        productId,
        productVariantId: productVariantId ?? null,
        quantity,
        unitPrice,
        unitTax,
        lineTotal,
      })

      return await this.recalculateAndReturn({ workspaceId, orderId, tx })
    })
  }

  async removeItem(props: {
    workspaceId: string
    orderId: string
    itemId: string
  }): Promise<OrderWithItems> {
    const { workspaceId, orderId, itemId } = props

    return await db.transaction(async (tx) => {
      await this.findDraftOrThrow({ workspaceId, orderId, tx })

      await tx
        .delete(orderItemModel)
        .where(
          and(
            eq(orderItemModel.id, itemId),
            eq(orderItemModel.orderId, orderId),
            eq(orderItemModel.workspaceId, workspaceId),
          ),
        )

      return await this.recalculateAndReturn({ workspaceId, orderId, tx })
    })
  }

  async checkout(props: {
    workspaceId: string
    orderId: string
    provider: string
    idempotencyKey: string
  }): Promise<{
    order: OrderModel
    checkoutReference: string
    redirectUrl?: string
  }> {
    const { workspaceId, orderId, provider, idempotencyKey } = props
    const adapter = getPaymentProvider(provider)

    const current = await db.query.orderModel.findFirst({
      where: { id: orderId, workspaceId },
    })
    if (!current) {
      throw notFoundException("Order not found")
    }

    if (current.status === "pending_payment") {
      if (current.checkoutIdempotencyKey === idempotencyKey) {
        const payment = await db.query.paymentModel.findFirst({
          where: { orderId, provider, workspaceId },
          orderBy: { createdAt: "desc" },
        })
        if (payment) {
          return await this.openProviderCheckout({
            adapter,
            order: current,
            payment,
            idempotencyKey,
          })
        }
      }
      throw orderStateConflictException(
        "Order already has a payment in progress",
      )
    }

    if (current.status !== "draft") {
      throw orderStateConflictException(
        `Order is ${current.status}; cannot check out`,
      )
    }

    const { order, payment } = await db.transaction(async (tx) => {
      const items = await tx.query.orderItemModel.findMany({
        where: { orderId, workspaceId },
      })
      if (items.length === 0) {
        throw new ChatbotXException("Cannot check out an order with no items")
      }

      // Atomic guard: of any concurrent checkout calls for this order, only
      // one UPDATE can match status = 'draft' and flip it.
      const [transitioned] = await tx
        .update(orderModel)
        .set({
          status: "pending_payment",
          checkoutIdempotencyKey: idempotencyKey,
          expiresAt: new Date(
            Date.now() + CHECKOUT_RESERVATION_TTL_MINUTES * 60_000,
          ),
        })
        .where(
          and(
            eq(orderModel.id, orderId),
            eq(orderModel.workspaceId, workspaceId),
            eq(orderModel.status, "draft"),
          ),
        )
        .returning()

      if (!transitioned) {
        throw orderStateConflictException(
          "Order was already checked out by a concurrent request",
        )
      }

      const location = await inventoryService.ensureDefaultLocation({
        workspaceId,
        tx,
      })

      for (const item of items) {
        await inventoryService.reserve({
          workspaceId,
          locationId: location.id,
          productId: item.productId,
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          referenceType: "order_item",
          referenceId: item.id,
          tx,
        })
        await tx
          .update(orderItemModel)
          .set({ locationId: location.id, reservedAt: new Date() })
          .where(eq(orderItemModel.id, item.id))
      }

      let payment: PaymentModel
      try {
        const [inserted] = await tx
          .insert(paymentModel)
          .values({
            id: createId(),
            workspaceId,
            orderId,
            provider,
            status: "pending",
            amount: transitioned.total,
            currency: transitioned.currency,
            idempotencyKey,
          })
          .returning()
        if (!inserted) {
          throw new ChatbotXException("Failed to create payment")
        }
        payment = inserted
      } catch (error) {
        if (!isUniqueViolationError(error)) {
          throw error
        }
        const existing = await tx.query.paymentModel.findFirst({
          where: { workspaceId, idempotencyKey },
        })
        if (!existing) {
          throw error
        }
        payment = existing
      }

      return { order: transitioned, payment }
    })

    // The provider call happens after the reservation transaction commits —
    // a real gateway call must never hold DB locks open across network I/O.
    return await this.openProviderCheckout({
      adapter,
      order,
      payment,
      idempotencyKey,
    })
  }

  async cancel(props: {
    workspaceId: string
    orderId: string
  }): Promise<OrderModel> {
    const { workspaceId, orderId } = props

    return await db.transaction(async (tx) => {
      const order = await tx.query.orderModel.findFirst({
        where: { id: orderId, workspaceId },
      })
      if (!order) {
        throw notFoundException("Order not found")
      }
      if (order.status !== "draft" && order.status !== "pending_payment") {
        throw orderStateConflictException(
          `Order is ${order.status}; cannot cancel`,
        )
      }

      await this.releaseAllHolds({ workspaceId, orderId, tx })

      const [updated] = await tx
        .update(orderModel)
        .set({ status: "cancelled" })
        .where(eq(orderModel.id, orderId))
        .returning()
      if (!updated) {
        throw new ChatbotXException("Failed to cancel order")
      }
      return updated
    })
  }

  /**
   * Called on a schedule (apps/worker's `schedule` cron, every minute — see
   * expire-stale-pending-orders.ts) to sweep ALL workspaces for
   * pending_payment orders whose checkout reservation TTL has passed.
   * Deliberately global and batch-limited: a cron tick has no workspace
   * context of its own, so workspaceId is read off each order row, never
   * accepted as a parameter here.
   *
   * Safe under retries and concurrent worker replicas:
   * - The pending_payment -> expired transition is a single conditional
   *   UPDATE (guarded on id + workspaceId + status). Only one caller can
   *   ever see it match for a given order; a re-run or a second replica
   *   racing the same order sees zero rows and does nothing further for it.
   * - releaseAllHolds only runs after that transition succeeds, and each
   *   item's hold is released through the same reservationReleasedAt
   *   guard `cancel()` uses — so even a duplicate call for an
   *   already-expired order cannot double-release.
   * - A late "paid" webhook racing this sweep resolves through
   *   `settlePaid`'s own guard: if the webhook's UPDATE ... WHERE
   *   status = 'pending_payment' wins first, the order ends up paid and
   *   this sweep's UPDATE later finds zero rows (no-op). If this sweep
   *   wins first, the order is expired and the late webhook's
   *   `settlePaid` call takes the payment_review branch instead of
   *   reusing/double-releasing the hold.
   */
  async expireStalePendingOrders(props: {
    batchSize?: number
    now?: Date
  }): Promise<{ expiredCount: number; processedCount: number }> {
    const { batchSize = EXPIRE_BATCH_SIZE, now = new Date() } = props
    const stale = await db
      .select()
      .from(orderModel)
      .where(
        and(
          eq(orderModel.status, "pending_payment"),
          lte(orderModel.expiresAt, now),
        ),
      )
      .limit(batchSize)

    let expiredCount = 0
    for (const order of stale) {
      const didExpire = await withBlockedOwnerGuard(
        order.workspaceId,
        async () =>
          await db.transaction(async (tx) => {
            const [transitioned] = await tx
              .update(orderModel)
              .set({ status: "expired" })
              .where(
                and(
                  eq(orderModel.id, order.id),
                  eq(orderModel.workspaceId, order.workspaceId),
                  eq(orderModel.status, "pending_payment"),
                ),
              )
              .returning()
            if (!transitioned) {
              return false
            }
            await this.releaseAllHolds({
              workspaceId: order.workspaceId,
              orderId: order.id,
              tx,
            })
            return true
          }),
      )
      if (didExpire) {
        expiredCount += 1
      }
    }
    return { expiredCount, processedCount: stale.length }
  }

  /** Called only by paymentService inside the verified-webhook transaction. */
  async settlePaid(props: {
    orderId: string
    workspaceId: string
    tx: DatabaseClient
  }): Promise<"paid" | "payment_review"> {
    const { orderId, workspaceId, tx } = props

    const current = await tx.query.orderModel.findFirst({
      where: { id: orderId, workspaceId },
    })
    if (!current) {
      throw notFoundException("Order not found")
    }

    if (current.status !== "pending_payment") {
      if (current.status === "paid") {
        return "paid"
      }
      const [review] = await tx
        .update(orderModel)
        .set({ status: "payment_review" })
        .where(
          and(
            eq(orderModel.id, orderId),
            eq(orderModel.workspaceId, workspaceId),
            eq(orderModel.status, current.status),
          ),
        )
        .returning()
      if (!review && current.status !== "payment_review") {
        throw orderStateConflictException(
          "Order changed while recording a late payment",
        )
      }
      return "payment_review"
    }

    const [order] = await tx
      .update(orderModel)
      .set({ status: "paid" })
      .where(
        and(
          eq(orderModel.id, orderId),
          eq(orderModel.workspaceId, workspaceId),
          eq(orderModel.status, "pending_payment"),
        ),
      )
      .returning()

    if (!order) {
      throw orderStateConflictException(
        "Order changed while confirming payment",
      )
    }

    const items = await tx.query.orderItemModel.findMany({
      where: { orderId, reservationReleasedAt: { isNull: true } },
    })

    for (const item of items) {
      if (!(item.reservedAt && item.locationId)) {
        continue
      }
      const resolved = await this.resolveReservation({ item, tx })
      if (!resolved) {
        continue
      }
      await inventoryService.consumeHold({
        workspaceId,
        locationId: item.locationId,
        productId: item.productId,
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        referenceType: "order_item",
        referenceId: item.id,
        tx,
      })
    }
    return "paid"
  }

  async reopenAfterPaymentFailure(props: {
    orderId: string
    workspaceId: string
    tx: DatabaseClient
  }): Promise<void> {
    const { orderId, workspaceId, tx } = props
    const [transitioned] = await tx
      .update(orderModel)
      .set({
        status: "draft",
        checkoutIdempotencyKey: null,
        expiresAt: null,
      })
      .where(
        and(
          eq(orderModel.id, orderId),
          eq(orderModel.workspaceId, workspaceId),
          eq(orderModel.status, "pending_payment"),
        ),
      )
      .returning()
    if (transitioned) {
      await this.releaseAllHolds({ workspaceId, orderId, tx })
    }
  }

  async markRefunded(props: {
    orderId: string
    workspaceId: string
    tx: DatabaseClient
  }): Promise<void> {
    const { orderId, workspaceId, tx } = props
    await tx
      .update(orderModel)
      .set({ status: "refunded" })
      .where(
        and(
          eq(orderModel.id, orderId),
          eq(orderModel.workspaceId, workspaceId),
          eq(orderModel.status, "paid"),
        ),
      )
  }

  private async openProviderCheckout(props: {
    adapter: PaymentProviderAdapter
    order: OrderModel
    payment: PaymentModel
    idempotencyKey: string
  }): Promise<{
    order: OrderModel
    checkoutReference: string
    redirectUrl?: string
  }> {
    const { adapter, order, payment, idempotencyKey } = props
    if (payment.checkoutReference) {
      return { order, checkoutReference: payment.checkoutReference }
    }

    // The adapter must pass this same key to the real gateway. A retry then
    // recovers a network timeout without reserving stock or creating another
    // Payment row.
    const session = await adapter.createCheckoutSession({
      orderId: order.id,
      workspaceId: order.workspaceId,
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey,
    })

    const [updated] = await db
      .update(paymentModel)
      .set({ checkoutReference: session.checkoutReference })
      .where(
        and(
          eq(paymentModel.id, payment.id),
          eq(paymentModel.workspaceId, order.workspaceId),
          eq(paymentModel.status, "pending"),
        ),
      )
      .returning()
    if (!updated) {
      throw orderStateConflictException(
        "Payment changed while opening checkout",
      )
    }

    return {
      order,
      checkoutReference: session.checkoutReference,
      redirectUrl: session.redirectUrl,
    }
  }

  private async findDraftOrThrow(props: {
    workspaceId: string
    orderId: string
    tx?: DatabaseClient
  }): Promise<OrderModel> {
    const { workspaceId, orderId, tx = db } = props
    const order = await tx.query.orderModel.findFirst({
      where: { id: orderId, workspaceId },
    })
    if (!order) {
      throw notFoundException("Order not found")
    }
    if (order.status !== "draft") {
      throw orderStateConflictException(
        `Order is ${order.status}; items can only be modified while draft`,
      )
    }
    return order
  }

  private async recalculateAndReturn(props: {
    workspaceId: string
    orderId: string
    tx: DatabaseClient
  }): Promise<OrderWithItems> {
    const { workspaceId, orderId, tx } = props
    const items = await tx.query.orderItemModel.findMany({
      where: { orderId },
    })
    const totals = recomputeOrderTotals(items)

    const [order] = await tx
      .update(orderModel)
      .set(totals)
      .where(
        and(
          eq(orderModel.id, orderId),
          eq(orderModel.workspaceId, workspaceId),
        ),
      )
      .returning()

    if (!order) {
      throw notFoundException("Order not found")
    }
    return { ...order, items }
  }

  /** Atomic idempotency guard shared by cancel/expire and markPaid. */
  private async resolveReservation(props: {
    item: OrderItemModel
    tx: DatabaseClient
  }): Promise<boolean> {
    const { item, tx } = props
    const [resolved] = await tx
      .update(orderItemModel)
      .set({ reservationReleasedAt: new Date() })
      .where(
        and(
          eq(orderItemModel.id, item.id),
          isNull(orderItemModel.reservationReleasedAt),
        ),
      )
      .returning()
    return Boolean(resolved)
  }

  private async releaseAllHolds(props: {
    workspaceId: string
    orderId: string
    tx: DatabaseClient
  }): Promise<void> {
    const { workspaceId, orderId, tx } = props
    const items = await tx.query.orderItemModel.findMany({ where: { orderId } })

    for (const item of items) {
      if (!(item.reservedAt && item.locationId)) {
        continue
      }
      const resolved = await this.resolveReservation({ item, tx })
      if (!resolved) {
        continue
      }
      await inventoryService.releaseHold({
        workspaceId,
        locationId: item.locationId,
        productId: item.productId,
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        referenceType: "order_item",
        referenceId: item.id,
        tx,
      })
    }
  }
}

export const orderService = new OrderService()
