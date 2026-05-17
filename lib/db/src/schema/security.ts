import { index, pgTable, text, timestamp, jsonb, uuid, boolean, integer } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspacesTable.id),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    severity: text("severity").notNull().default("info"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    oldData: jsonb("old_data"),
    newData: jsonb("new_data"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_audit_ws_created").on(table.workspaceId, table.createdAt)],
);

export const loginEventsTable = pgTable("login_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => usersTable.id),
  email: text("email").notNull(),
  success: boolean("success").notNull(),
  failureReason: text("failure_reason"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionsTable = pgTable("session", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true }).notNull(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type InsertAuditLog = typeof auditLogsTable.$inferInsert;
export type LoginEvent = typeof loginEventsTable.$inferSelect;
