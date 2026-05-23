import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const workspacesTable = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  plan: text("plan").notNull().default("trial"),
  status: text("status").notNull().default("active"),
  settings: jsonb("settings").notNull().default({}),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  deactivatedBy: uuid("deactivated_by").references(() => usersTable.id),
  deactivationReason: text("deactivation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspacesTable.$inferSelect;
export type InsertWorkspace = typeof workspacesTable.$inferInsert;
