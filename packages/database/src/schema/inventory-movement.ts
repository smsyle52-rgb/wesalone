import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
} from "drizzle-orm/pg-core"
import { inventoryMovementReasonTypes } from "../partials/inventory"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inventoryLocationModel } from "./inventory-location"
import { productModel } from "./product"
import { productVariantModel } from "./product-variant"
import { workspaceModel } from "./workspace"

export const inventoryMovementReason = pgEnum(
  "inventoryMovementReason",
  inventoryMovementReasonTypes.options as [string, ...string[]],
)

// Append-only audit ledger — never updated or deleted, one row per stock
// change. `quantity` is signed (+in / -out).
export const inventoryMovementModel = pgTable(
  "InventoryMovement",
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
    quantity: integer().notNull(),
    reason: inventoryMovementReason().notNull(),
    referenceType: text(),
    referenceId: bigintAsString(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("InventoryMovement_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    index("InventoryMovement_reference_idx").using(
      "btree",
      table.referenceType.asc().nullsLast(),
      table.referenceId.asc().nullsLast(),
    ),
    check("InventoryMovement_quantity_nonzero", sql`${table.quantity} <> 0`),
  ],
)
