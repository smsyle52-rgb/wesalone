import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contactChannelsTable, contactsTable } from "./contacts";
import { channelAccountsTable, messagesTable } from "./conversations";
import { whatsappTemplatesTable } from "./templates";
import { usersTable } from "./users";
import { workspacesTable } from "./workspaces";

export const broadcastsTable = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    templateId: uuid("template_id").notNull().references(() => whatsappTemplatesTable.id),
    channelAccountId: uuid("channel_account_id").notNull().references(() => channelAccountsTable.id),
    audienceFilter: jsonb("audience_filter").notNull().default({}),
    variableMapping: jsonb("variable_mapping").notNull().default({}),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    stats: jsonb("stats").notNull().default({
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
    }),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_broadcasts_ws_status").on(table.workspaceId, table.status, table.scheduledAt)],
);

export const broadcastRecipientsTable = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcastsTable.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contactsTable.id),
    contactChannelId: uuid("contact_channel_id").references(() => contactChannelsTable.id),
    status: text("status").notNull().default("queued"),
    messageId: uuid("message_id").references(() => messagesTable.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    uniqueIndex("uq_broadcast_recipients_broadcast_contact").on(table.broadcastId, table.contactId),
    index("idx_broadcast_recipients_bc").on(table.broadcastId, table.status),
    index("idx_broadcast_recipients_contact").on(table.workspaceId, table.contactId),
  ],
);

export type Broadcast = typeof broadcastsTable.$inferSelect;
export type InsertBroadcast = typeof broadcastsTable.$inferInsert;
export type BroadcastRecipient = typeof broadcastRecipientsTable.$inferSelect;
export type InsertBroadcastRecipient = typeof broadcastRecipientsTable.$inferInsert;
