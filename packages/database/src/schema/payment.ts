import { sql } from "drizzle-orm"
import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { paymentStatusTypes } from "../partials/payment"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { orderModel } from "./order"
import { workspaceModel } from "./workspace"

export const paymentStatus = pgEnum(
  "paymentStatus",
  paymentStatusTypes.options as [string, ...string[]],
)

export const paymentModel = pgTable(
  "Payment",
  {
    ...sharedColumns,
    orderId: bigintAsString()
      .notNull()
      .references(() => orderModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // Free-form identifier (not a pgEnum): onboarding a real gateway later
    // needs zero schema migration, only a new adapter + registry entry.
    provider: text().notNull(),
    status: paymentStatus().default("pending").notNull(),
    amount: numeric({ precision: 20, scale: 2, mode: "number" }).notNull(),
    currency: text().notNull(),
    checkoutReference: text(),
    providerPaymentReference: text(),
    idempotencyKey: text().notNull(),
    confirmedAt: timestamp(timestampConfig),
    failureReason: text(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("Payment_orderId_idx").using(
      "btree",
      table.orderId.asc().nullsLast(),
    ),
    index("Payment_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("Payment_workspaceId_idempotencyKey_key").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("Payment_provider_providerPaymentReference_key")
      .on(table.provider, table.providerPaymentReference)
      .where(sql`${table.providerPaymentReference} IS NOT NULL`),
    uniqueIndex("Payment_provider_checkoutReference_key")
      .on(table.provider, table.checkoutReference)
      .where(sql`${table.checkoutReference} IS NOT NULL`),
    check("Payment_amount_positive", sql`${table.amount} > 0`),
  ],
)
