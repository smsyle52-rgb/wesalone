import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { workspacesTable } from "./workspaces";

export const automationsTable = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default([]),
    actions: jsonb("actions").notNull().default([]),
    status: text("status").notNull().default("draft"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    runCount: integer("run_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_automations_ws_status").on(table.workspaceId, table.status)],
);

export const automationRunsTable = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automationsTable.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    triggerPayload: jsonb("trigger_payload").notNull(),
    conditionsEvaluated: jsonb("conditions_evaluated"),
    actionsExecuted: jsonb("actions_executed"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("idx_automation_runs_auto").on(table.automationId, table.startedAt)],
);

export type Automation = typeof automationsTable.$inferSelect;
export type InsertAutomation = typeof automationsTable.$inferInsert;
export type AutomationRun = typeof automationRunsTable.$inferSelect;
export type InsertAutomationRun = typeof automationRunsTable.$inferInsert;
