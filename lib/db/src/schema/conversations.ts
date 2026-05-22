import { index, pgTable, text, timestamp, integer, uuid, boolean, jsonb } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { contactChannelsTable } from "./contacts";
import { usersTable } from "./users";
import { workspaceMembershipsTable, teamsTable } from "./rbac";

export const channelAccountsTable = pgTable("channel_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  channelType: text("channel_type").notNull(),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("active"),
  providerConfig: jsonb("provider_config"),
  credentialsSecretRef: text("credentials_secret_ref"),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationsTable = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contactsTable.id),
    contactChannelId: uuid("contact_channel_id").references(() => contactChannelsTable.id),
    channelAccountId: uuid("channel_account_id").references(() => channelAccountsTable.id),
    externalThreadId: text("external_thread_id"),
    channel: text("channel").notNull().default("manual"),
    status: text("status").notNull().default("new"),
    priority: text("priority").notNull().default("normal"),
    subject: text("subject"),
    assignedMembershipId: uuid("assigned_membership_id").references(() => workspaceMembershipsTable.id),
    teamId: uuid("team_id").references(() => teamsTable.id),
    lastMessage: text("last_message"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    aiSummary: text("ai_summary"),
    needsHuman: boolean("needs_human").notNull().default(false),
    escalationReason: text("escalation_reason"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conv_ws_status").on(table.workspaceId, table.status),
    index("idx_conv_ws_assigned").on(table.workspaceId, table.assignedMembershipId),
    index("idx_conv_ws_lastmsg").on(table.workspaceId, table.lastMessageAt),
  ],
);

export const messagesTable = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id"),
    direction: text("direction").notNull().default("outbound"),
    senderType: text("sender_type").notNull().default("user"),
    senderId: uuid("sender_id").references(() => usersTable.id),
    senderName: text("sender_name"),
    source: text("source").notNull().default("manual"),
    contentType: text("content_type").notNull().default("text"),
    content: text("content").notNull(),
    attachments: jsonb("attachments").notNull().default([]),
    isAiDraft: boolean("is_ai_draft").notNull().default(false),
    isPrivateNote: boolean("is_private_note").notNull().default(false),
    deliveryStatus: text("delivery_status").notNull().default("sent"),
    providerPayload: jsonb("provider_payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_msg_conv_created").on(table.conversationId, table.createdAt),
    index("idx_msg_ws_provider").on(table.workspaceId, table.providerMessageId),
  ],
);

export type ChannelAccount = typeof channelAccountsTable.$inferSelect;
export type InsertChannelAccount = typeof channelAccountsTable.$inferInsert;
export type Conversation = typeof conversationsTable.$inferSelect;
export type InsertConversation = typeof conversationsTable.$inferInsert;
export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = typeof messagesTable.$inferInsert;
