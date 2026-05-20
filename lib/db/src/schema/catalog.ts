import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { channelAccountsTable } from "./conversations";

export const catalogSourcesTable = pgTable(
  "catalog_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id").references(() => channelAccountsTable.id, { onDelete: "set null" }),
    sourceType: text("source_type").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    syncStatus: text("sync_status").notNull().default("pending"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    syncCursor: text("sync_cursor"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_catalog_sources_ws_type_external").on(table.workspaceId, table.sourceType, table.externalId),
    index("idx_catalog_sources_ws").on(table.workspaceId, table.sourceType),
  ],
);

export const productsTable = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    catalogSourceId: uuid("catalog_source_id").notNull().references(() => catalogSourcesTable.id, { onDelete: "cascade" }),
    externalProductId: text("external_product_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    price: numeric("price", { precision: 14, scale: 2 }),
    currency: text("currency").default("YER"),
    availability: text("availability"),
    inventoryCount: integer("inventory_count"),
    imageUrl: text("image_url"),
    productUrl: text("product_url"),
    brand: text("brand"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    isVisible: boolean("is_visible").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_products_ws_source_external").on(table.workspaceId, table.catalogSourceId, table.externalProductId),
    index("idx_products_ws").on(table.workspaceId, table.isVisible),
    index("idx_products_source").on(table.catalogSourceId),
    index("idx_products_availability").on(table.workspaceId, table.availability),
  ],
);

export const socialPostsTable = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    catalogSourceId: uuid("catalog_source_id").notNull().references(() => catalogSourcesTable.id, { onDelete: "cascade" }),
    externalPostId: text("external_post_id").notNull(),
    message: text("message"),
    postType: text("post_type"),
    permalinkUrl: text("permalink_url"),
    mediaUrl: text("media_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_social_posts_ws_source_external").on(table.workspaceId, table.catalogSourceId, table.externalPostId),
    index("idx_social_posts_ws").on(table.workspaceId, table.publishedAt),
  ],
);

export const adCampaignsTable = pgTable(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    catalogSourceId: uuid("catalog_source_id").notNull().references(() => catalogSourcesTable.id, { onDelete: "cascade" }),
    externalAdId: text("external_ad_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    objective: text("objective"),
    promotedProductIds: jsonb("promoted_product_ids").$type<string[]>().default([]),
    adCreativeText: text("ad_creative_text"),
    adCreativeImageUrl: text("ad_creative_image_url"),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_ad_campaigns_ws_source_external").on(table.workspaceId, table.catalogSourceId, table.externalAdId),
    index("idx_ad_campaigns_ws_status").on(table.workspaceId, table.status),
  ],
);

export const catalogSyncRunsTable = pgTable(
  "catalog_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    catalogSourceId: uuid("catalog_source_id").notNull().references(() => catalogSourcesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    itemsSynced: integer("items_synced").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_sync_runs_source").on(table.catalogSourceId, table.startedAt),
  ],
);

export type CatalogSource = typeof catalogSourcesTable.$inferSelect;
export type InsertCatalogSource = typeof catalogSourcesTable.$inferInsert;
export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = typeof productsTable.$inferInsert;
export type SocialPost = typeof socialPostsTable.$inferSelect;
export type InsertSocialPost = typeof socialPostsTable.$inferInsert;
export type AdCampaign = typeof adCampaignsTable.$inferSelect;
export type InsertAdCampaign = typeof adCampaignsTable.$inferInsert;
export type CatalogSyncRun = typeof catalogSyncRunsTable.$inferSelect;
export type InsertCatalogSyncRun = typeof catalogSyncRunsTable.$inferInsert;
