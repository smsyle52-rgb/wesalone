import { pgTable, text, timestamp, uuid, numeric, date, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const metricsEventsTable = pgTable("metrics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  actorId: uuid("actor_id").references(() => usersTable.id),
  value: numeric("value", { precision: 15, scale: 4 }),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyStatsTable = pgTable("daily_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  statDate: date("stat_date").notNull(),
  contactsCount: integer("contacts_count").notNull().default(0),
  conversationsCount: integer("conversations_count").notNull().default(0),
  messagesCount: integer("messages_count").notNull().default(0),
  ticketsOpen: integer("tickets_open").notNull().default(0),
  tasksPending: integer("tasks_pending").notNull().default(0),
  followupsPending: integer("followups_pending").notNull().default(0),
  opportunitiesOpen: integer("opportunities_open").notNull().default(0),
  ordersCount: integer("orders_count").notNull().default(0),
  ordersTotal: numeric("orders_total", { precision: 15, scale: 2 }).notNull().default("0"),
  paymentsConfirmedTotal: numeric("payments_confirmed_total", { precision: 15, scale: 2 }).notNull().default("0"),
  debtsOpenTotal: numeric("debts_open_total", { precision: 15, scale: 2 }).notNull().default("0"),
  aiRunsCount: integer("ai_runs_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamDailyStatsTable = pgTable("team_daily_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  statDate: date("stat_date").notNull(),
  memberId: uuid("member_id").notNull().references(() => usersTable.id),
  conversationsAssigned: integer("conversations_assigned").notNull().default(0),
  messagesSent: integer("messages_sent").notNull().default(0),
  ticketsResolved: integer("tickets_resolved").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  followupsCompleted: integer("followups_completed").notNull().default(0),
  ordersCreated: integer("orders_created").notNull().default(0),
  paymentsRecorded: integer("payments_recorded").notNull().default(0),
  aiRunsUsed: integer("ai_runs_used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const REPORT_TYPES = ["overview", "operations", "sales", "finance", "ai", "team", "channel"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportDefinitionsTable = pgTable("report_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("overview"),
  description: text("description"),
  config: jsonb("config").notNull().default({}),
  isArchived: boolean("is_archived").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const GENERATED_REPORT_STATUSES = ["generated", "failed"] as const;
export type GeneratedReportStatus = (typeof GENERATED_REPORT_STATUSES)[number];

export const generatedReportsTable = pgTable("generated_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  reportDefinitionId: uuid("report_definition_id").references(() => reportDefinitionsTable.id),
  type: text("type").notNull().default("overview"),
  title: text("title").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  status: text("status").notNull().default("generated"),
  data: jsonb("data").notNull().default({}),
  generatedBy: uuid("generated_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MetricsEvent = typeof metricsEventsTable.$inferSelect;
export type DailyStat = typeof dailyStatsTable.$inferSelect;
export type TeamDailyStat = typeof teamDailyStatsTable.$inferSelect;
export type ReportDefinition = typeof reportDefinitionsTable.$inferSelect;
export type GeneratedReport = typeof generatedReportsTable.$inferSelect;
