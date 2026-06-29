import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";
import { paymentsTable } from "./payments";
import { ordersTable } from "./orders";

export const paymentRefundsTable = pgTable("payment_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("YER"),
  status: text("status").notNull().default("pending"),
  reason: text("reason").notNull(),
  externalReference: text("external_reference"),
  recordedBy: uuid("recorded_by").references(() => usersTable.id),
  verifiedBy: uuid("verified_by").references(() => usersTable.id),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
