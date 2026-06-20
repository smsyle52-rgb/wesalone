import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

// كتالوج المنتجات الداخلي للتاجر (مختلف عن products من catalog.ts الذي يخص كتالوج ميتا)
export const inventoryProductsTable = pgTable(
  "inventory_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku"),
    price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("YER"),
    unit: text("unit"),
    imageUrl: text("image_url"),
    quantityAvailable: integer("quantity_available"),
    // pickup_only = لا توصيل، local = داخل المدينة فقط، all = بلا قيد
    deliveryPolicy: text("delivery_policy").notNull().default("all"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_inv_products_workspace").on(table.workspaceId, table.isArchived),
    index("idx_inv_products_sku").on(table.workspaceId, table.sku),
  ],
);

export type InventoryProduct = typeof inventoryProductsTable.$inferSelect;
export type InsertInventoryProduct = typeof inventoryProductsTable.$inferInsert;
