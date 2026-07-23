import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
} from "drizzle-orm/pg-core"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { inventoryLocationModel } from "./inventory-location"
import { orderModel } from "./order"
import { productModel } from "./product"
import { productVariantModel } from "./product-variant"
import { workspaceModel } from "./workspace"

// Also doubles as the inventory reservation record for its line: reservedAt
// / reservationReleasedAt track the hold placed on InventoryStock.reserved
// (see inventoryService.reserve/release). A 1:1 order-item -> reservation
// relationship, so no separate reservation table.
export const orderItemModel = pgTable(
  "OrderItem",
  {
    ...sharedColumns,
    orderId: bigintAsString()
      .notNull()
      .references(() => orderModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // restrict (not cascade): a product with order history must not be
    // silently deletable, and order lines must not silently lose their
    // product reference.
    productId: bigintAsString()
      .notNull()
      .references(() => productModel.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    productVariantId: bigintAsString().references(
      () => productVariantModel.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    locationId: bigintAsString().references(() => inventoryLocationModel.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    quantity: integer().notNull(),
    // Snapshotted from Product/ProductVariant at the time the item was
    // added — never accepted from the client.
    unitPrice: numeric({ precision: 20, scale: 2, mode: "number" }).notNull(),
    unitTax: numeric({ precision: 20, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    lineTotal: numeric({ precision: 20, scale: 2, mode: "number" }).notNull(),
    reservedAt: timestamp(timestampConfig),
    reservationReleasedAt: timestamp(timestampConfig),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("OrderItem_orderId_idx").using(
      "btree",
      table.orderId.asc().nullsLast(),
    ),
    index("OrderItem_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    check("OrderItem_quantity_positive", sql`${table.quantity} > 0`),
    check("OrderItem_unitPrice_nonnegative", sql`${table.unitPrice} >= 0`),
    check("OrderItem_unitTax_nonnegative", sql`${table.unitTax} >= 0`),
    check("OrderItem_lineTotal_nonnegative", sql`${table.lineTotal} >= 0`),
  ],
)
