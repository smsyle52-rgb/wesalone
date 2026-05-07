import { pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { workspaceMembershipsTable, teamsTable } from "./rbac";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const ticketsTable = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("normal"),
  category: text("category"),
  contactId: uuid("contact_id").references(() => contactsTable.id),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  sourceMessageId: uuid("source_message_id"),
  assignedMembershipId: uuid("assigned_membership_id").references(() => workspaceMembershipsTable.id),
  teamId: uuid("team_id").references(() => teamsTable.id),
  dueAt: timestamp("due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Ticket = typeof ticketsTable.$inferSelect;
export type InsertTicket = typeof ticketsTable.$inferInsert;
