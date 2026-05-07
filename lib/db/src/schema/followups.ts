import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { workspaceMembershipsTable } from "./rbac";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";
import { opportunitiesTable } from "./opportunities";

export const followupsTable = pgTable("followups", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contactsTable.id),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  opportunityId: uuid("opportunity_id").references(() => opportunitiesTable.id),
  assignedMembershipId: uuid("assigned_membership_id").references(() => workspaceMembershipsTable.id),
  createdBy: uuid("created_by").references(() => usersTable.id),
  type: text("type").notNull().default("manual"),
  status: text("status").notNull().default("pending"),
  title: text("title"),
  dueAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("note"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by").references(() => usersTable.id),
  skippedReason: text("skipped_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Followup = typeof followupsTable.$inferSelect;
export type InsertFollowup = typeof followupsTable.$inferInsert;
