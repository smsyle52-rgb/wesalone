import { pgTable, text, timestamp, boolean, uuid, bigint } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

export const filesTable = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by").references(() => usersTable.id),
  storageProvider: text("storage_provider").notNull().default("gcs"),
  bucket: text("bucket"),
  objectKey: text("object_key").notNull(),
  url: text("url").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  scanStatus: text("scan_status").notNull().default("pending"),
  isPublic: boolean("is_public").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type File = typeof filesTable.$inferSelect;
export type InsertFile = typeof filesTable.$inferInsert;
