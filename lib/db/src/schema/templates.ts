import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { channelAccountsTable } from "./conversations";
import { usersTable } from "./users";
import { workspacesTable } from "./workspaces";

export const whatsappTemplatesTable = pgTable(
  "whatsapp_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull().default("ar"),
    category: text("category").notNull(),
    status: text("status").notNull().default("draft"),
    metaTemplateId: text("meta_template_id"),
    rejectionReason: text("rejection_reason"),
    channelAccountId: uuid("channel_account_id").references(() => channelAccountsTable.id),
    components: jsonb("components").notNull().default([]),
    variables: jsonb("variables").notNull().default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_whatsapp_templates_ws_name_language").on(table.workspaceId, table.name, table.language),
    index("idx_templates_ws_status").on(table.workspaceId, table.status),
  ],
);

export const templateVersionsTable = pgTable(
  "template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => whatsappTemplatesTable.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull(),
    components: jsonb("components").notNull(),
    responseJson: jsonb("response_json"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_template_versions_template_version").on(table.templateId, table.versionNumber),
    index("idx_template_versions_tpl").on(table.templateId, table.versionNumber),
  ],
);

export type WhatsappTemplate = typeof whatsappTemplatesTable.$inferSelect;
export type InsertWhatsappTemplate = typeof whatsappTemplatesTable.$inferInsert;
export type TemplateVersion = typeof templateVersionsTable.$inferSelect;
export type InsertTemplateVersion = typeof templateVersionsTable.$inferInsert;
