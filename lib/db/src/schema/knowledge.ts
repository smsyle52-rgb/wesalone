import { customType, pgTable, text, timestamp, uuid, integer, jsonb } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const KNOWLEDGE_BASE_STATUSES = ["active", "archived"] as const;
export type KnowledgeBaseStatus = (typeof KNOWLEDGE_BASE_STATUSES)[number];

export const KNOWLEDGE_SOURCE_TYPES = ["text", "faq", "file", "url"] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_SOURCE_STATUSES = ["draft", "processing", "ready", "failed", "archived"] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export const KNOWLEDGE_DOCUMENT_STATUSES = ["draft", "ready", "archived"] as const;
export type KnowledgeDocumentStatus = (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];

export const KNOWLEDGE_EMBEDDING_STATUSES = ["pending", "skipped", "embedded", "failed"] as const;
export type KnowledgeEmbeddingStatus = (typeof KNOWLEDGE_EMBEDDING_STATUSES)[number];

export const FAQ_STATUSES = ["active", "archived"] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

export const EMBEDDINGS_PROVIDERS = ["none", "pgvector", "vertex_vector_search"] as const;
export type EmbeddingsProvider = (typeof EMBEDDINGS_PROVIDERS)[number];

export const EMBEDDINGS_INDEX_STATUSES = ["not_configured", "configured", "disabled"] as const;
export type EmbeddingsIndexStatus = (typeof EMBEDDINGS_INDEX_STATUSES)[number];

const tsvector = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return "tsvector";
  },
});

export const knowledgeBasesTable = pgTable("knowledge_bases", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeSourcesTable = pgTable("knowledge_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("text"),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  sourceUrl: text("source_url"),
  fileId: uuid("file_id"),
  rawText: text("raw_text"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeDocumentsTable = pgTable("knowledge_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => knowledgeSourcesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  contentText: text("content_text").notNull(),
  status: text("status").notNull().default("draft"),
  tokenEstimate: integer("token_estimate"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeChunksTable = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => knowledgeDocumentsTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  tokenEstimate: integer("token_estimate"),
  embeddingStatus: text("embedding_status").notNull().default("pending"),
  embeddingRef: text("embedding_ref"),
  embeddingModel: text("embedding_model"),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }),
  tsv: tsvector("tsv"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const faqEntriesTable = pgTable("faq_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category"),
  status: text("status").notNull().default("active"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embeddingsIndexReferenceTable = pgTable("embeddings_index_reference", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBasesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("none"),
  indexName: text("index_name"),
  status: text("status").notNull().default("not_configured"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeBase = typeof knowledgeBasesTable.$inferSelect;
export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
export type FaqEntry = typeof faqEntriesTable.$inferSelect;
export type EmbeddingsIndexReference = typeof embeddingsIndexReferenceTable.$inferSelect;
