import { pgTable, text, timestamp, boolean, uuid, numeric, jsonb, date, unique, integer, index } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const plansTable = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  key: text("key").unique(),
  nameAr: text("name_ar"),
  isActive: boolean("is_active").notNull().default(true),
  priceYer: numeric("price_yer", { precision: 10, scale: 2 }),
  priceYerAnnual: numeric("price_yer_annual", { precision: 10, scale: 2 }),
  priceUsd: numeric("price_usd", { precision: 10, scale: 2 }),
  priceUsdAnnual: numeric("price_usd_annual", { precision: 10, scale: 2 }),
  priceSar: numeric("price_sar", { precision: 10, scale: 2 }),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  sortOrder: integer("sort_order").notNull().default(100),
  limits: jsonb("limits").notNull().default({}),
  features: text("features").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").unique().notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plansTable.id),
  status: text("status").notNull().default("trial"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: date("current_period_start"),
  currentPeriodEnd: date("current_period_end"),
  paymentMethod: text("payment_method"),
  lastPaymentRef: text("last_payment_ref"),
  // رصيد نقاط مُشترى (top-up) فوق نقاط الباقة الشهرية — يُستهلك بعد نفاد نقاط الباقة
  pointsBalance: integer("points_balance").notNull().default(0),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageCountersTable = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    periodMonth: text("period_month").notNull(),
    messagesSent: integer("messages_sent").notNull().default(0),
    agentsCount: integer("agents_count").notNull().default(0),
    contactsCount: integer("contacts_count").notNull().default(0),
    teamMembers: integer("team_members").notNull().default(0),
    // نقاط الذكاء المستهلكة خلال الشهر (ردّ عادي=1، صعب/رؤية/صوت=3) — المقياس الأساسي للفوترة
    pointsUsed: integer("points_used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("usage_counters_workspace_period_unique").on(table.workspaceId, table.periodMonth),
    index("idx_usage_counters_ws_period").on(table.workspaceId, table.periodMonth),
  ],
);

export const paymentSubmissionsTable = pgTable(
  "payment_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    // submissionType: subscription (plan payment) | point_topup (points recharge)
    submissionType: text("submission_type").notNull().default("subscription"),
    // planId مطلوب فقط عند submission_type='subscription'
    planId: uuid("plan_id").references(() => plansTable.id),
    // pointPurchaseOrderId مطلوب فقط عند submission_type='point_topup'
    pointPurchaseOrderId: uuid("point_purchase_order_id"),
    // Legacy Phase-1 subscription payments — YER amount (nullable for new point_topup rows)
    amountYer: numeric("amount_yer", { precision: 14, scale: 2 }),
    amountCurrency: text("amount_currency").notNull().default("YER"),
    exchangeRateSnapshot: jsonb("exchange_rate_snapshot"),
    // Phase-2+ multi-currency: string in minor units (e.g. "70000" = 700.00 USD at 2 decimals)
    paidAmountMinor: text("paid_amount_minor"),
    paidCurrency: text("paid_currency"),
    paymentMethod: text("payment_method").notNull(),
    reference: text("reference"),
    receiptNote: text("receipt_note"),
    receiptFileUrl: text("receipt_file_url"),
    status: text("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => usersTable.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_payment_submissions_ws_status").on(table.workspaceId, table.status),
    index("idx_payment_submissions_status_created").on(table.status, table.createdAt),
  ],
);

export const featureFlagsTable = pgTable("feature_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  flagKey: text("flag_key").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  config: jsonb("config").notNull().default({}),
}, (table) => [
  unique("feature_flags_workspace_key_unique").on(table.workspaceId, table.flagKey),
]);

export type Plan = typeof plansTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type UsageCounter = typeof usageCountersTable.$inferSelect;
export type PaymentSubmission = typeof paymentSubmissionsTable.$inferSelect;
export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
