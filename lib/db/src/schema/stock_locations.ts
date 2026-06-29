import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { productVariantsTable } from "./product_variants";

export const stockLocationsTable = pgTable("stock_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("warehouse"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_stock_locations_ws_name").on(table.workspaceId, table.name),
  index("idx_stock_locations_ws_active").on(table.workspaceId, table.isActive),
]);

export const inventoryStockLevelsTable = pgTable("inventory_stock_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull().references(() => stockLocationsTable.id, { onDelete: "cascade" }),
  onHand: integer("on_hand").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  incoming: integer("incoming").notNull().default(0),
  available: integer("available"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_inventory_level_ws_variant_location").on(table.workspaceId, table.productVariantId, table.locationId),
  index("idx_inventory_level_location").on(table.workspaceId, table.locationId),
]);

export type StockLocation = typeof stockLocationsTable.$inferSelect;
export type InventoryStockLevel = typeof inventoryStockLevelsTable.$inferSelect;
