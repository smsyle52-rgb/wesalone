import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inventoryLocationModel } from "./inventory-location"
import { productModel } from "./product"
import { productVariantModel } from "./product-variant"
import { workspaceModel } from "./workspace"

// One row per (location, sellable unit). `productVariantId` is null when the
// product has no variants — stock is then tracked at the product level.
export const inventoryStockModel = pgTable(
  "InventoryStock",
  {
    ...sharedColumns,
    locationId: bigintAsString()
      .notNull()
      .references(() => inventoryLocationModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    productId: bigintAsString()
      .notNull()
      .references(() => productModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    productVariantId: bigintAsString().references(
      () => productVariantModel.id,
      { onDelete: "cascade", onUpdate: "cascade" },
    ),
    onHand: integer().default(0).notNull(),
    reserved: integer().default(0).notNull(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    // Partial unique indexes (nulls are distinct in Postgres, so a plain
    // unique index on (locationId, productVariantId) would allow duplicate
    // no-variant rows) — mirrors the PlatformCredential pattern.
    uniqueIndex("InventoryStock_location_variant_key")
      .on(table.locationId, table.productVariantId)
      .where(sql`${table.productVariantId} IS NOT NULL`),
    uniqueIndex("InventoryStock_location_product_novariant_key")
      .on(table.locationId, table.productId)
      .where(sql`${table.productVariantId} IS NULL`),
    index("InventoryStock_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    index("InventoryStock_productId_idx").using(
      "btree",
      table.productId.asc().nullsLast(),
    ),
    check("InventoryStock_onHand_nonnegative", sql`${table.onHand} >= 0`),
    check("InventoryStock_reserved_nonnegative", sql`${table.reserved} >= 0`),
    check(
      "InventoryStock_reserved_not_over_onHand",
      sql`${table.reserved} <= ${table.onHand}`,
    ),
  ],
)
