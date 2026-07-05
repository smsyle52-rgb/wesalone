import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { channelAccountsTable } from "./conversations";

export const contactChannelIdentitiesTable = pgTable(
  "contact_channel_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id").notNull().references(() => channelAccountsTable.id, { onDelete: "cascade" }),
    channelType: text("channel_type").notNull(),
    identityType: text("identity_type").notNull(),
    identityValue: text("identity_value").notNull(),
    normalizedIdentity: text("normalized_identity").notNull(),
    businessScopeId: text("business_scope_id"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    providerData: jsonb("provider_data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_contact_channel_identities_scope").on(
      table.workspaceId,
      table.channelAccountId,
      table.identityType,
      table.normalizedIdentity,
    ),
    index("idx_contact_channel_identities_contact").on(table.workspaceId, table.contactId),
    index("idx_contact_channel_identities_lookup").on(
      table.workspaceId,
      table.channelType,
      table.identityType,
      table.normalizedIdentity,
    ),
    index("idx_contact_channel_identities_business_scope").on(
      table.workspaceId,
      table.channelType,
      table.businessScopeId,
    ).where(sql`business_scope_id is not null`),
  ],
);

export type ContactChannelIdentity = typeof contactChannelIdentitiesTable.$inferSelect;
export type InsertContactChannelIdentity = typeof contactChannelIdentitiesTable.$inferInsert;
