import {
  and,
  type DatabaseClient,
  db,
  eq,
  isNull,
  isUniqueViolationError,
  sql,
} from "@chatbotx.io/database/client"
import type { InventoryMovementReasonType } from "@chatbotx.io/database/partials"
import {
  inventoryLocationModel,
  inventoryMovementModel,
  inventoryStockModel,
} from "@chatbotx.io/database/schema"
import type { InventoryLocationModel } from "@chatbotx.io/database/types"
import { createId } from "@chatbotx.io/utils"
import { BaseService } from "../base.service"
import { ChatbotXException, insufficientStockException } from "../errors"

type StockUnit = {
  workspaceId: string
  locationId: string
  productId: string
  productVariantId?: string | null
}

const variantCondition = (productVariantId?: string | null) =>
  productVariantId
    ? eq(inventoryStockModel.productVariantId, productVariantId)
    : isNull(inventoryStockModel.productVariantId)

class InventoryService extends BaseService {
  /**
   * Every workspace gets a single implicit default location until multi-
   * location management is exposed in the UI (out of scope here).
   */
  async ensureDefaultLocation(props: {
    workspaceId: string
    tx?: DatabaseClient
  }): Promise<InventoryLocationModel> {
    const { workspaceId, tx = db } = props
    const existing = await tx.query.inventoryLocationModel.findFirst({
      where: { workspaceId, isDefault: true },
    })
    if (existing) {
      return existing
    }

    try {
      const [location] = await tx
        .insert(inventoryLocationModel)
        .values({
          id: createId(),
          workspaceId,
          name: "Default",
          isDefault: true,
          isActive: true,
        })
        .returning()
      if (!location) {
        throw new ChatbotXException(
          "Failed to create default inventory location",
        )
      }
      return location
    } catch (error) {
      // Two concurrent callers can both miss the row in findFirst and race
      // the insert — the partial unique index lets exactly one win.
      if (isUniqueViolationError(error)) {
        const created = await tx.query.inventoryLocationModel.findFirst({
          where: { workspaceId, isDefault: true },
        })
        if (created) {
          return created
        }
      }
      throw error
    }
  }

  async ensureStockRow(
    props: StockUnit & { tx?: DatabaseClient },
  ): Promise<void> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      tx = db,
    } = props
    const existing = await tx.query.inventoryStockModel.findFirst({
      where: productVariantId
        ? { workspaceId, locationId, productId, productVariantId }
        : {
            workspaceId,
            locationId,
            productId,
            productVariantId: { isNull: true },
          },
    })
    if (existing) {
      return
    }
    try {
      await tx.insert(inventoryStockModel).values({
        id: createId(),
        workspaceId,
        locationId,
        productId,
        productVariantId: productVariantId ?? null,
        onHand: 0,
        reserved: 0,
      })
    } catch (error) {
      if (!isUniqueViolationError(error)) {
        throw error
      }
    }
  }

  async getStock(
    props: StockUnit & { tx?: DatabaseClient },
  ): Promise<{ onHand: number; reserved: number; available: number }> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      tx = db,
    } = props
    const row = await tx.query.inventoryStockModel.findFirst({
      where: productVariantId
        ? { workspaceId, locationId, productId, productVariantId }
        : {
            workspaceId,
            locationId,
            productId,
            productVariantId: { isNull: true },
          },
    })
    const onHand = row?.onHand ?? 0
    const reserved = row?.reserved ?? 0
    return { onHand, reserved, available: onHand - reserved }
  }

  /** Manual restock — increases onHand. Not exposed via API in this pass. */
  async receive(
    props: StockUnit & {
      quantity: number
      referenceType: string
      referenceId: string
      tx?: DatabaseClient
    },
  ): Promise<void> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      referenceType,
      referenceId,
      tx = db,
    } = props
    if (quantity <= 0) {
      throw new ChatbotXException("Received quantity must be positive")
    }
    await this.ensureStockRow({
      workspaceId,
      locationId,
      productId,
      productVariantId,
      tx,
    })
    await tx
      .update(inventoryStockModel)
      .set({ onHand: sql`${inventoryStockModel.onHand} + ${quantity}` })
      .where(
        and(
          eq(inventoryStockModel.locationId, locationId),
          eq(inventoryStockModel.productId, productId),
          eq(inventoryStockModel.workspaceId, workspaceId),
          variantCondition(productVariantId),
        ),
      )
    await this.logMovement({
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      reason: "receive",
      referenceType,
      referenceId,
      tx,
    })
  }

  /**
   * Atomically holds `quantity` units against available stock (onHand -
   * reserved). A single conditional UPDATE — Postgres re-checks the WHERE
   * clause after taking the row lock, so two concurrent reserves against the
   * last unit can never both succeed: the loser's UPDATE affects zero rows.
   */
  async reserve(
    props: StockUnit & {
      quantity: number
      referenceType: string
      referenceId: string
      tx: DatabaseClient
    },
  ): Promise<void> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      referenceType,
      referenceId,
      tx,
    } = props
    if (quantity <= 0) {
      throw new ChatbotXException("Reservation quantity must be positive")
    }

    await this.ensureStockRow({
      workspaceId,
      locationId,
      productId,
      productVariantId,
      tx,
    })

    const [updated] = await tx
      .update(inventoryStockModel)
      .set({ reserved: sql`${inventoryStockModel.reserved} + ${quantity}` })
      .where(
        and(
          eq(inventoryStockModel.locationId, locationId),
          eq(inventoryStockModel.productId, productId),
          eq(inventoryStockModel.workspaceId, workspaceId),
          variantCondition(productVariantId),
          sql`${inventoryStockModel.onHand} - ${inventoryStockModel.reserved} >= ${quantity}`,
        ),
      )
      .returning()

    if (!updated) {
      throw insufficientStockException()
    }

    await this.logMovement({
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      reason: "reserve",
      referenceType,
      referenceId,
      tx,
    })
  }

  /**
   * Releases a previously reserved hold (order cancelled/expired before
   * payment). Caller (orderService) is responsible for the idempotency guard
   * — this always decrements `reserved` when called, so it must only be
   * called once per hold.
   */
  async releaseHold(
    props: StockUnit & {
      quantity: number
      referenceType: string
      referenceId: string
      tx: DatabaseClient
    },
  ): Promise<void> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      referenceType,
      referenceId,
      tx,
    } = props

    const [updated] = await tx
      .update(inventoryStockModel)
      .set({ reserved: sql`${inventoryStockModel.reserved} - ${quantity}` })
      .where(
        and(
          eq(inventoryStockModel.locationId, locationId),
          eq(inventoryStockModel.productId, productId),
          eq(inventoryStockModel.workspaceId, workspaceId),
          variantCondition(productVariantId),
          sql`${inventoryStockModel.reserved} >= ${quantity}`,
        ),
      )
      .returning()

    if (!updated) {
      throw new ChatbotXException(
        "Inventory stock row missing while releasing a hold",
      )
    }

    await this.logMovement({
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity: -quantity,
      reason: "release",
      referenceType,
      referenceId,
      tx,
    })
  }

  /**
   * Converts a hold into a permanent deduction on payment confirmation:
   * onHand and reserved both drop by `quantity`. Caller guards idempotency
   * (must only be called once per paid order item).
   */
  async consumeHold(
    props: StockUnit & {
      quantity: number
      referenceType: string
      referenceId: string
      tx: DatabaseClient
    },
  ): Promise<void> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      referenceType,
      referenceId,
      tx,
    } = props

    const [updated] = await tx
      .update(inventoryStockModel)
      .set({
        onHand: sql`${inventoryStockModel.onHand} - ${quantity}`,
        reserved: sql`${inventoryStockModel.reserved} - ${quantity}`,
      })
      .where(
        and(
          eq(inventoryStockModel.locationId, locationId),
          eq(inventoryStockModel.productId, productId),
          eq(inventoryStockModel.workspaceId, workspaceId),
          variantCondition(productVariantId),
          sql`${inventoryStockModel.reserved} >= ${quantity}`,
          sql`${inventoryStockModel.onHand} >= ${quantity}`,
        ),
      )
      .returning()

    if (!updated) {
      throw new ChatbotXException(
        "Inventory stock row missing while consuming a hold",
      )
    }

    await this.logMovement({
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity: -quantity,
      reason: "consume",
      referenceType,
      referenceId,
      tx,
    })
  }

  private async logMovement(
    props: StockUnit & {
      quantity: number
      reason: InventoryMovementReasonType
      referenceType: string
      referenceId: string
      tx: DatabaseClient
    },
  ): Promise<void> {
    const {
      workspaceId,
      locationId,
      productId,
      productVariantId,
      quantity,
      reason,
      referenceType,
      referenceId,
      tx,
    } = props
    await tx.insert(inventoryMovementModel).values({
      id: createId(),
      workspaceId,
      locationId,
      productId,
      productVariantId: productVariantId ?? null,
      quantity,
      reason,
      referenceType,
      referenceId,
    })
  }
}

export const inventoryService = new InventoryService()
