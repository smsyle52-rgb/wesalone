import { index, pgTable, text, timestamp, numeric, uuid, jsonb } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { ordersTable } from "./orders";
import { usersTable } from "./users";
import { paymentMethodsTable, exchangeRatesTable } from "./finance";

export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("YER"),

    method: text("method").notNull().default("cash"),

    paymentMethodId: uuid("payment_method_id").references(() => paymentMethodsTable.id),
    methodSnapshot: jsonb("method_snapshot"),

    exchangeRateId: uuid("exchange_rate_id").references(() => exchangeRatesTable.id),
    exchangeRateSnapshot: jsonb("exchange_rate_snapshot"),

    baseAmountYer: numeric("base_amount_yer", { precision: 14, scale: 2 }),

    paidAt: timestamp("paid_at", { withTimezone: true }),

    status: text("status").notNull().default("pending"),
    contactId: uuid("contact_id").references(() => contactsTable.id),
    orderId: uuid("order_id").references(() => ordersTable.id),
    reference: text("reference"),
    notes: text("notes"),
    confirmedBy: uuid("confirmed_by").references(() => usersTable.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => usersTable.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_payments_ws_status").on(table.workspaceId, table.status)],
);

export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
