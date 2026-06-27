import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { ordersTable } from "./orders";

export const orderStateTransitionsTable = pgTable("order_state_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  changedBy: uuid("changed_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_order_state_transitions_order").on(table.workspaceId, table.orderId, table.createdAt),
  uniqueIndex("uq_order_state_transitions_ws_order_key").on(table.workspaceId, table.orderId, table.idempotencyKey),
]);

export type OrderStateTransition = typeof orderStateTransitionsTable.$inferSelect;
