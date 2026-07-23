import { and, db, eq } from "@chatbotx.io/database/client"
import { fileStatuses } from "@chatbotx.io/database/partials"
import {
  fileModel,
  pointPurchaseOrderModel,
  pointTopupProductModel,
  userModel,
} from "@chatbotx.io/database/schema"
import type { PointPurchaseOrderModel } from "@chatbotx.io/database/types"
import { uploader } from "@chatbotx.io/filesystem"
import { ChatbotXException } from "../errors"
import { verifyReceiptFile } from "../platform-subscription-payment/service"
import { pointWalletService } from "../point-wallet/service"

const UNDER_REVIEW = "under_review"

async function findPayableProduct(slug: string) {
  const now = new Date()
  const product = await db.query.pointTopupProductModel.findFirst({
    where: { slug, isActive: true },
  })
  if (!product) {
    throw new ChatbotXException("Unknown point bundle", "productNotFound", 404)
  }
  if (product.effectiveFrom && product.effectiveFrom > now) {
    throw new ChatbotXException(
      "This point bundle is not on sale yet.",
      "productNotYetEffective",
      400,
    )
  }
  if (product.effectiveUntil && product.effectiveUntil < now) {
    throw new ChatbotXException(
      "This point bundle is no longer available.",
      "productExpired",
      400,
    )
  }
  return product
}

/**
 * Manual (Kuraimi/Jawali/bank-transfer/cash + admin review) point top-up
 * flow — ported from Wesal One's original point_purchase_orders /
 * PointsWalletPage, mirroring platformSubscriptionPaymentService's
 * createSubmission/confirmSubmission/rejectSubmission shape exactly so the
 * two manual-payment trust paths in this codebase never drift apart.
 *
 * Trust boundary: a submitted order never credits points by itself. Only
 * confirmOrder (super-admin-only action) credits, and only via
 * pointWalletService.createGrant — the same grant path a plan's monthly
 * allowance uses.
 */
class PointPurchaseOrderService {
  async submitOrder(props: {
    userId: string
    workspaceId: string
    topupProductSlug: string
    paymentMethod: string
    reference?: string | null
    receiptFileId: string
    receiptNote?: string | null
  }): Promise<PointPurchaseOrderModel> {
    const product = await findPayableProduct(props.topupProductSlug)
    const file = await verifyReceiptFile(props.workspaceId, props.receiptFileId)

    const [duplicate] = await db
      .select({ id: pointPurchaseOrderModel.id })
      .from(pointPurchaseOrderModel)
      .where(
        and(
          eq(pointPurchaseOrderModel.userId, props.userId),
          eq(pointPurchaseOrderModel.topupProductId, product.id),
          eq(pointPurchaseOrderModel.status, UNDER_REVIEW),
        ),
      )
      .limit(1)
    if (duplicate) {
      throw new ChatbotXException(
        "An order for this bundle is already under review.",
        "duplicateUnderReview",
        409,
      )
    }

    const [order] = await db
      .insert(pointPurchaseOrderModel)
      .values({
        userId: props.userId,
        topupProductId: product.id,
        productSlugSnapshot: product.slug,
        productNameSnapshot: product.nameEn,
        pointsSnapshot: product.points,
        priceCentsSnapshot: product.priceCents,
        currencySnapshot: product.currency,
        paymentMethod: props.paymentMethod,
        reference: props.reference ?? null,
        receiptFileId: file.id,
        receiptNote: props.receiptNote ?? null,
        status: UNDER_REVIEW,
      })
      .returning()

    await db
      .update(fileModel)
      .set({ status: fileStatuses.enum.uploaded, uploadedAt: new Date() })
      .where(
        and(
          eq(fileModel.id, file.id),
          eq(fileModel.workspaceId, props.workspaceId),
        ),
      )

    return order
  }

  async cancelOrder(props: {
    userId: string
    orderId: string
  }): Promise<PointPurchaseOrderModel> {
    const [updated] = await db
      .update(pointPurchaseOrderModel)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(pointPurchaseOrderModel.id, props.orderId),
          eq(pointPurchaseOrderModel.userId, props.userId),
          eq(pointPurchaseOrderModel.status, UNDER_REVIEW),
        ),
      )
      .returning()
    if (!updated) {
      throw new ChatbotXException(
        "This order can no longer be cancelled.",
        "notCancellable",
        409,
      )
    }
    return updated
  }

  /**
   * Super-admin-only. Row-locked + a conditional UPDATE
   * (`WHERE status = 'under_review'`) makes a concurrent or retried confirm
   * a no-op instead of a double-credit — the same guard
   * confirmSubmission uses for plan payments.
   */
  async confirmOrder(props: {
    orderId: string
    reviewedByUserId: string
  }): Promise<PointPurchaseOrderModel> {
    return await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(pointPurchaseOrderModel)
        .where(eq(pointPurchaseOrderModel.id, props.orderId))
        .for("update")
        .limit(1)
      if (!order) {
        throw new ChatbotXException("Order not found.", "notFound", 404)
      }
      if (order.status !== UNDER_REVIEW) {
        throw new ChatbotXException(
          "This order is no longer under review.",
          "notUnderReview",
          409,
        )
      }

      const grant = await pointWalletService.createGrant(
        {
          userId: order.userId,
          grantType: "purchased",
          points: order.pointsSnapshot,
          sourceType: "point_purchase_order",
          sourceId: order.id,
          idempotencyKey: `point-purchase:${order.id}`,
          reason: `purchased: ${order.productNameSnapshot}`,
        },
        tx,
      )

      const [updated] = await tx
        .update(pointPurchaseOrderModel)
        .set({
          status: "approved",
          reviewedBy: props.reviewedByUserId,
          reviewedAt: new Date(),
          creditedGrantId: grant.id,
        })
        .where(
          and(
            eq(pointPurchaseOrderModel.id, order.id),
            eq(pointPurchaseOrderModel.status, UNDER_REVIEW),
          ),
        )
        .returning()
      if (!updated) {
        throw new ChatbotXException(
          "This order was already reviewed by someone else.",
          "concurrentUpdate",
          409,
        )
      }
      return updated
    })
  }

  async rejectOrder(props: {
    orderId: string
    reviewedByUserId: string
    reason: string
  }): Promise<PointPurchaseOrderModel> {
    const [updated] = await db
      .update(pointPurchaseOrderModel)
      .set({
        status: "rejected",
        reviewedBy: props.reviewedByUserId,
        reviewedAt: new Date(),
        rejectionReason: props.reason,
      })
      .where(
        and(
          eq(pointPurchaseOrderModel.id, props.orderId),
          eq(pointPurchaseOrderModel.status, UNDER_REVIEW),
        ),
      )
      .returning()
    if (!updated) {
      throw new ChatbotXException(
        "This order is no longer under review.",
        "notUnderReview",
        409,
      )
    }
    return updated
  }

  async listForUser(
    userId: string,
  ): Promise<(PointPurchaseOrderModel & { receiptUrl: string | null })[]> {
    const orders = await db
      .select()
      .from(pointPurchaseOrderModel)
      .where(eq(pointPurchaseOrderModel.userId, userId))
      .orderBy(pointPurchaseOrderModel.createdAt)

    return await Promise.all(
      orders.map(async (order) => ({
        ...order,
        receiptUrl: order.receiptFileId
          ? await this.getReceiptViewUrl(order.receiptFileId)
          : null,
      })),
    )
  }

  async listActiveProducts() {
    return await db.query.pointTopupProductModel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    })
  }

  async listForAdmin(status?: string) {
    const rows = await db
      .select({
        order: pointPurchaseOrderModel,
        buyerName: userModel.name,
        buyerEmail: userModel.email,
        productNameEn: pointTopupProductModel.nameEn,
      })
      .from(pointPurchaseOrderModel)
      .innerJoin(userModel, eq(pointPurchaseOrderModel.userId, userModel.id))
      .innerJoin(
        pointTopupProductModel,
        eq(pointPurchaseOrderModel.topupProductId, pointTopupProductModel.id),
      )
      .where(
        status && status !== "all"
          ? eq(pointPurchaseOrderModel.status, status)
          : undefined,
      )
      .orderBy(pointPurchaseOrderModel.createdAt)

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        receiptUrl: row.order.receiptFileId
          ? await this.getReceiptViewUrl(row.order.receiptFileId)
          : null,
      })),
    )
  }

  private async getReceiptViewUrl(receiptFileId: string) {
    const file = await db.query.fileModel.findFirst({
      where: { id: receiptFileId },
      columns: { path: true },
    })
    if (!file) {
      return null
    }
    return await uploader.getPresignedDownload(file.path)
  }
}

export const pointPurchaseOrderService = new PointPurchaseOrderService()
