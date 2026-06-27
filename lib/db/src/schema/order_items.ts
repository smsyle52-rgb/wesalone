import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { ordersTable } from "./orders";
import { inventoryProductsTable } from "./products";
import { productVariantsTable } from "./product_variants";
import { stockLocationsTable } from "./stock_locations";

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  inventoryProductId: uuid("inventory_product_id").references(() => inventoryProductsTable.id, { onDelete: "set null" }),
  productVariantId: uuid("product_variant_id").references(() => productVariantsTable.id, { onDelete: "set null" }),
  locationId: uuid("location_id").references(() => stockLocationsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  tax: numeric("tax", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("YER"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  reservationStatus: text("reservation_status").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrderItem = typeof orderItemsTable.$inferSelect;
export type InsertOrderItem = typeof orderItemsTable.$inferInsert;
