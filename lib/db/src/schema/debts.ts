import { pgTable, text, timestamp, uuid, numeric } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { ordersTable } from "./orders";
import { paymentsTable } from "./payments";
import { usersTable } from "./users";
import { workspaceMembershipsTable } from "./rbac";

export const DEBT_STATUSES = ["open", "partial", "paid", "overdue", "written_off", "cancelled"] as const;
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export const debtsTable = pgTable("debts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contactsTable.id),
  orderId: uuid("order_id").references(() => ordersTable.id),
  sourcePaymentId: uuid("source_payment_id").references(() => paymentsTable.id),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("YER"),
  remainingAmount: numeric("remaining_amount", { precision: 15, scale: 2 }).notNull(),
  status: text("status").notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  description: text("description"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  assignedMembershipId: uuid("assigned_membership_id").references(() => workspaceMembershipsTable.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  writtenOffAt: timestamp("written_off_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  writeOffReason: text("write_off_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionNotesTable = pgTable("collection_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  debtId: uuid("debt_id").notNull().references(() => debtsTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contactsTable.id),
  authorId: uuid("author_id").notNull().references(() => usersTable.id),
  note: text("note").notNull(),
  promisedPaymentDate: timestamp("promised_payment_date", { withTimezone: true }),
  promisedAmount: numeric("promised_amount", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Debt = typeof debtsTable.$inferSelect;
export type CollectionNote = typeof collectionNotesTable.$inferSelect;
