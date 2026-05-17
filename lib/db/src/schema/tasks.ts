import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { workspaceMembershipsTable } from "./rbac";
import { usersTable } from "./users";
import { contactsTable } from "./contacts";
import { conversationsTable } from "./conversations";

export const tasksTable = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("pending"),
    priority: text("priority").notNull().default("normal"),
    contactId: uuid("contact_id").references(() => contactsTable.id),
    conversationId: uuid("conversation_id").references(() => conversationsTable.id),
    sourceMessageId: uuid("source_message_id"),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assignedMembershipId: uuid("assigned_membership_id").references(() => workspaceMembershipsTable.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => usersTable.id),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_tasks_ws_status_due").on(table.workspaceId, table.status, table.dueAt)],
);

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;
