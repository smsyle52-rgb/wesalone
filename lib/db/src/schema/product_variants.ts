import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { inventoryProductsTable } from "./products";

export const productVariantsTable = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => inventoryProductsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("افتراضي"),
    sku: text("sku"),
    barcode: text("barcode"),
    optionValues: jsonb("option_values").$type<Record<string, string>>().notNull().default({}),
    price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
    cost: numeric("cost", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("YER"),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_product_variants_ws_product").on(table.workspaceId, table.productId),
    uniqueIndex("uq_product_variants_ws_sku").on(table.workspaceId, table.sku),
    uniqueIndex("uq_product_variants_ws_barcode").on(table.workspaceId, table.barcode),
  ],
);

export type ProductVariant = typeof productVariantsTable.$inferSelect;
export type InsertProductVariant = typeof productVariantsTable.$inferInsert;
