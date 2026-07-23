import { sql } from "drizzle-orm"
import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { workspaceModel } from "./workspace"

export const inventoryLocationModel = pgTable(
  "InventoryLocation",
  {
    ...sharedColumns,
    name: text().notNull(),
    isDefault: boolean().default(false).notNull(),
    isActive: boolean().default(true).notNull(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("InventoryLocation_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("InventoryLocation_workspaceId_default_key")
      .on(table.workspaceId)
      .where(sql`${table.isDefault} = true`),
  ],
)
