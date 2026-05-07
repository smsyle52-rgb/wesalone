import {
  pgTable, text, timestamp, boolean, uuid, primaryKey
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const rolesTable = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissionsTable = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  slug: text("slug").unique().notNull(),
  description: text("description"),
});

export const rolePermissionsTable = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissionsTable.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]);

export const workspaceMembershipsTable = pgTable("workspace_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  invitedBy: uuid("invited_by").references(() => usersTable.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const membershipRolesTable = pgTable("membership_roles", {
  membershipId: uuid("membership_id").notNull().references(() => workspaceMembershipsTable.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  assignedBy: uuid("assigned_by").references(() => usersTable.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.membershipId, table.roleId] })]);

export const teamsTable = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembersTable = pgTable("team_members", {
  teamId: uuid("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  membershipId: uuid("membership_id").notNull().references(() => workspaceMembershipsTable.id, { onDelete: "cascade" }),
  isLead: boolean("is_lead").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.teamId, table.membershipId] })]);

export const workspaceMembershipsRelations = relations(workspaceMembershipsTable, ({ one, many }) => ({
  workspace: one(workspacesTable, { fields: [workspaceMembershipsTable.workspaceId], references: [workspacesTable.id] }),
  user: one(usersTable, { fields: [workspaceMembershipsTable.userId], references: [usersTable.id] }),
  membershipRoles: many(membershipRolesTable),
}));

export const rolesRelations = relations(rolesTable, ({ many }) => ({
  rolePermissions: many(rolePermissionsTable),
  membershipRoles: many(membershipRolesTable),
}));

export type Role = typeof rolesTable.$inferSelect;
export type Permission = typeof permissionsTable.$inferSelect;
export type WorkspaceMembership = typeof workspaceMembershipsTable.$inferSelect;
export type Team = typeof teamsTable.$inferSelect;
