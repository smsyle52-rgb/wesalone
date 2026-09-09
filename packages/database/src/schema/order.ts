import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { orderStatusTypes } from "../partials/order"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { contactModel } from "./contact"
import { workspaceModel } from "./workspace"

export const orderStatus = pgEnum(
  "orderStatus",
  orderStatusTypes.options as [string, ...string[]],
)

export const orderModel = pgTable(
  "Order",
  {
    ...sharedColumns,
    status: orderStatus().default("draft").notNull(),
    // Short per-merchant counter starting at 5000, the only order number any
    // human sees. `id` is a 17-digit snowflake: the agent used to read it out
    // in full while the merchant's list showed `id.slice(-8)`, so a customer
    // quoting "their" order number named something the merchant could not
    // find. Nullable because the column predates its backfill and because a
    // NULL never blocks the unique index below.
    orderNumber: integer(),
    contactId: bigintAsString().references(() => contactModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    currency: text().notNull().default("USD"),
    // Snapshotted totals — always server-computed from current product
    // prices at checkout time, never accepted from the client.
    subtotal: numeric({ precision: 20, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    taxTotal: numeric({ precision: 20, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    discountTotal: numeric({ precision: 20, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    total: numeric({ precision: 20, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    // Caller-supplied key that de-duplicates draft-order creation.
    idempotencyKey: text(),
    // Separate key that de-duplicates the checkout call itself (an order can
    // be drafted once and checked out — retried — independently).
    checkoutIdempotencyKey: text(),
    expiresAt: timestamp(timestampConfig),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("Order_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    index("Order_workspaceId_status_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    uniqueIndex("Order_workspaceId_orderNumber_key").on(
      table.workspaceId,
      table.orderNumber,
    ),
    uniqueIndex("Order_workspaceId_idempotencyKey_key")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("Order_workspaceId_checkoutIdempotencyKey_key")
      .on(table.workspaceId, table.checkoutIdempotencyKey)
      .where(sql`${table.checkoutIdempotencyKey} IS NOT NULL`),
    check("Order_subtotal_nonnegative", sql`${table.subtotal} >= 0`),
    check("Order_taxTotal_nonnegative", sql`${table.taxTotal} >= 0`),
    check("Order_discountTotal_nonnegative", sql`${table.discountTotal} >= 0`),
    check("Order_total_nonnegative", sql`${table.total} >= 0`),
  ],
)
