import { boolean, index, integer, jsonb, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const quickRepliesTable = pgTable(
  "quick_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    shortcut: text("shortcut").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_quick_replies_ws").on(table.workspaceId),
    uniqueIndex("uq_quick_replies_ws_shortcut").on(table.workspaceId, table.shortcut),
  ],
);

export const savedViewsTable = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => usersTable.id),
    name: text("name").notNull(),
    resource: text("resource").notNull(),
    filters: jsonb("filters").notNull().default({}),
    isPinned: boolean("is_pinned").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_saved_views_ws_user").on(table.workspaceId, table.userId, table.sortOrder),
  ],
);

export const slaRulesTable = pgTable(
  "sla_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channelType: text("channel_type"),
    priority: text("priority"),
    firstResponseMinutes: integer("first_response_minutes").notNull(),
    resolutionMinutes: integer("resolution_minutes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_sla_rules_ws_active").on(table.workspaceId, table.active),
  ],
);

export const businessHoursTable = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    openTime: time("open_time"),
    closeTime: time("close_time"),
    isClosed: boolean("is_closed").notNull().default(false),
    timezone: text("timezone").notNull().default("Asia/Aden"),
  },
  (table) => [
    uniqueIndex("uq_business_hours_ws_day").on(table.workspaceId, table.dayOfWeek),
  ],
);

export type QuickReply = typeof quickRepliesTable.$inferSelect;
export type InsertQuickReply = typeof quickRepliesTable.$inferInsert;
export type SavedView = typeof savedViewsTable.$inferSelect;
export type InsertSavedView = typeof savedViewsTable.$inferInsert;
export type SlaRule = typeof slaRulesTable.$inferSelect;
export type InsertSlaRule = typeof slaRulesTable.$inferInsert;
export type BusinessHour = typeof businessHoursTable.$inferSelect;
export type InsertBusinessHour = typeof businessHoursTable.$inferInsert;
