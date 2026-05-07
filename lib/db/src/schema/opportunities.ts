import { pgTable, text, timestamp, numeric, integer, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { workspaceMembershipsTable } from "./rbac";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const opportunitiesTable = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  stage: text("stage").notNull().default("new"),
  value: numeric("value", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("YER"),
  contactId: uuid("contact_id").references(() => contactsTable.id),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  sourceMessageId: uuid("source_message_id"),
  assignedMembershipId: uuid("assigned_membership_id").references(() => workspaceMembershipsTable.id),
  probability: integer("probability"),
  expectedCloseDate: text("expected_close_date"),
  notes: text("notes"),
  lostReason: text("lost_reason"),
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Opportunity = typeof opportunitiesTable.$inferSelect;
export type InsertOpportunity = typeof opportunitiesTable.$inferInsert;
