import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { ordersTable } from "./orders";
import { orderItemsTable } from "./order_items";
import { productVariantsTable } from "./product_variants";
import { stockLocationsTable } from "./stock_locations";

export const inventoryReservationsTable = pgTable("inventory_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").notNull().references(() => orderItemsTable.id, { onDelete: "cascade" }),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariantsTable.id),
  locationId: uuid("location_id").notNull().references(() => stockLocationsTable.id),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => usersTable.id),
  correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_inventory_reservations_order").on(table.workspaceId, table.orderId, table.status),
  index("idx_inventory_reservations_expiry").on(table.workspaceId, table.status, table.expiresAt),
  uniqueIndex("uq_inventory_reservations_ws_idempotency").on(table.workspaceId, table.idempotencyKey),
]);

export type InventoryReservation = typeof inventoryReservationsTable.$inferSelect;
