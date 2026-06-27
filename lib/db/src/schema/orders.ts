import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const ordersTable = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull(),
  status: text("status").notNull().default("Draft"),
  channel: text("channel").notNull().default("manual"),
  contactId: uuid("contact_id").references(() => contactsTable.id),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  opportunityId: uuid("opportunity_id"),
  sourceMessageId: uuid("source_message_id"),
  assignedMembershipId: uuid("assigned_membership_id"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("YER"),
  notes: text("notes"),
  cancelReason: text("cancel_reason"),
  returnedReason: text("returned_reason"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  reservedAt: timestamp("reserved_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  exchangedAt: timestamp("exchanged_at", { withTimezone: true }),
  paymentStatus: text("payment_status").notNull().default("Unpaid"),
  deliveryType: text("delivery_type").notNull().default("pickup"),
  deliveryStatus: text("delivery_status"),
  deliveryAgentPhone: text("delivery_agent_phone"),
  carrierName: text("carrier_name"),
  carrierPhone: text("carrier_phone"),
  deliveryReceiptUrl: text("delivery_receipt_url"),
  deliveryAddress: text("delivery_address"),
  deliveryFee: numeric("delivery_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  codEnabled: boolean("cod_enabled").notNull().default(false),
  items: jsonb("items"),
  version: integer("version").notNull().default(0),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_orders_ws_status").on(table.workspaceId, table.status)]);

export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = typeof ordersTable.$inferInsert;
