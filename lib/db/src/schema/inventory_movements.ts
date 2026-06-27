import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { ordersTable } from "./orders";
import { orderItemsTable } from "./order_items";
import { productVariantsTable } from "./product_variants";
import { stockLocationsTable } from "./stock_locations";
import { inventoryReservationsTable } from "./inventory_reservations";

export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  productVariantId: uuid("product_variant_id").notNull().references(() => productVariantsTable.id),
  locationId: uuid("location_id").notNull().references(() => stockLocationsTable.id),
  quantity: integer("quantity").notNull(),
  movementType: text("movement_type").notNull(),
  reason: text("reason").notNull(),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  orderItemId: uuid("order_item_id").references(() => orderItemsTable.id, { onDelete: "set null" }),
  reservationId: uuid("reservation_id").references(() => inventoryReservationsTable.id, { onDelete: "set null" }),
  destinationLocationId: uuid("destination_location_id").references(() => stockLocationsTable.id),
  createdBy: uuid("created_by").references(() => usersTable.id),
  correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_inventory_movements_ws_variant").on(table.workspaceId, table.productVariantId, table.createdAt),
  index("idx_inventory_movements_order").on(table.workspaceId, table.orderId),
  uniqueIndex("uq_inventory_movements_ws_idempotency").on(table.workspaceId, table.idempotencyKey),
]);

export type InventoryMovement = typeof inventoryMovementsTable.$inferSelect;
