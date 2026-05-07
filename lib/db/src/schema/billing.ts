import { pgTable, text, timestamp, boolean, uuid, numeric, jsonb, date, unique } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const plansTable = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  priceYer: numeric("price_yer", { precision: 10, scale: 2 }),
  priceUsd: numeric("price_usd", { precision: 10, scale: 2 }),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  limits: jsonb("limits").notNull().default({}),
  features: text("features").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").unique().notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plansTable.id),
  status: text("status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: date("current_period_start"),
  currentPeriodEnd: date("current_period_end"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
