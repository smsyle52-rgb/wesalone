import {
  pgTable, text, timestamp, numeric, integer, uuid, boolean, jsonb, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const contactsTable = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    city: text("city"),
    company: text("company"),
    tags: text("tags").array().notNull().default([]),
    totalOrders: integer("total_orders").notNull().default(0),
    totalSpent: numeric("total_spent", { precision: 12, scale: 2 }).notNull().default("0"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_contacts_ws").on(table.workspaceId),
    index("idx_contacts_ws_created").on(table.workspaceId, table.createdAt),
  ],
);

export const contactChannelsTable = pgTable(
  "contact_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    channelType: text("channel_type").notNull(),
    identifier: text("identifier").notNull(),
    normalizedIdentifier: text("normalized_identifier").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    optedIn: boolean("opted_in").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    providerData: jsonb("provider_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_cc_workspace_type_identifier").on(
      table.workspaceId,
      table.channelType,
      table.normalizedIdentifier,
    ),
    index("idx_contact_channels_normalized").on(table.workspaceId, table.channelType, table.normalizedIdentifier),
  ],
);

export const contactNotesTable = pgTable("contact_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspacesTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contactsTable.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => usersTable.id),
  body: text("body").notNull(),
  isPrivate: boolean("is_private").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactTimelineTable = pgTable("contact_timeline", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspacesTable.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contactsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  title: text("title").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").references(() => usersTable.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Contact = typeof contactsTable.$inferSelect;
export type InsertContact = typeof contactsTable.$inferInsert;
export type ContactChannel = typeof contactChannelsTable.$inferSelect;
export type ContactNote = typeof contactNotesTable.$inferSelect;
export type ContactTimeline = typeof contactTimelineTable.$inferSelect;
