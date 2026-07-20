import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { manualPaymentMethods } from "../partials/manual-payment"
import { pointPurchaseOrderStatuses } from "../partials/point"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { fileModel } from "./file"
import { pointGrantModel } from "./point-grant"
import { pointTopupProductModel } from "./point-topup-product"

export const pointPurchaseOrderStatus = pgEnum(
  "pointPurchaseOrderStatus",
  pointPurchaseOrderStatuses.options as [string, ...string[]],
)

export const pointPurchaseOrderPaymentMethod = pgEnum(
  "pointPurchaseOrderPaymentMethod",
  manualPaymentMethods.options as [string, ...string[]],
)

// Manual (Kuraimi/Jawali/bank-transfer/cash + admin-review) point top-up
// order — mirrors PlatformSubscriptionPayment's claim/review shape, ported
// from Wesal One's original point_purchase_orders. Product fields are
// snapshotted at order time so a later catalog price change never rewrites
// history. `creditedGrantId` is the exactly-once guard: approval creates a
// PointGrant (grantType "purchased") and stamps its id here, so re-approving
// an already-approved order is a no-op rather than a double-credit.
export const pointPurchaseOrderModel = pgTable(
  "PointPurchaseOrder",
  {
    ...sharedColumns,
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, { onDelete: "cascade" }),
    topupProductId: bigintAsString()
      .notNull()
      .references(() => pointTopupProductModel.id),
    productSlugSnapshot: text().notNull(),
    productNameSnapshot: text().notNull(),
    pointsSnapshot: integer().notNull(),
    priceCentsSnapshot: integer().notNull(),
    currencySnapshot: text().default("USD").notNull(),
    status: pointPurchaseOrderStatus().default("pending_payment").notNull(),
    paymentMethod: pointPurchaseOrderPaymentMethod(),
    reference: text(),
    receiptFileId: bigintAsString().references(() => fileModel.id, {
      onDelete: "set null",
    }),
    receiptNote: text(),
    reviewedBy: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp(timestampConfig),
    rejectionReason: text(),
    creditedGrantId: bigintAsString().references(() => pointGrantModel.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("PointPurchaseOrder_userId_status_idx").on(
      table.userId,
      table.status,
    ),
    index("PointPurchaseOrder_status_createdAt_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
)
