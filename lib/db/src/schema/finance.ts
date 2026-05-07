import { pgTable, text, timestamp, boolean, uuid, numeric, integer, jsonb } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const paymentMethodsTable = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  labelAr: text("label_ar").notNull(),
  labelEn: text("label_en"),
  isActive: boolean("is_active").notNull().default(true),
  requiresReference: boolean("requires_reference").notNull().default(false),
  requiresReceipt: boolean("requires_receipt").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exchangeRatesTable = pgTable("exchange_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  fromCurrency: text("from_currency").notNull(),
  toCurrency: text("to_currency").notNull().default("YER"),
  rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
  setBy: uuid("set_by").references(() => usersTable.id),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;
export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
