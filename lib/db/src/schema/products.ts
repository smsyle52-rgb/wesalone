import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

// Internal merchant catalog. quantityAvailable remains for migration compatibility only.
export const inventoryProductsTable = pgTable(
  "inventory_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku"),
    barcode: text("barcode"),
    price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
    cost: numeric("cost", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("YER"),
    unit: text("unit"),
    imageUrl: text("image_url"),
    images: jsonb("images").$type<string[]>().notNull().default([]),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    status: text("status").notNull().default("active"),
    quantityAvailable: integer("quantity_available"),
    deliveryPolicy: text("delivery_policy").notNull().default("all"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_inv_products_workspace").on(table.workspaceId, table.isArchived),
    index("idx_inv_products_status").on(table.workspaceId, table.status),
    index("idx_inv_products_sku").on(table.workspaceId, table.sku),
    index("idx_inv_products_barcode").on(table.workspaceId, table.barcode),
  ],
);

export type InventoryProduct = typeof inventoryProductsTable.$inferSelect;
export type InsertInventoryProduct = typeof inventoryProductsTable.$inferInsert;
