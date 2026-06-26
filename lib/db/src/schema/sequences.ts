import { bigint, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const workspaceSequencesTable = pgTable(
  "workspace_sequences",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    sequenceName: text("sequence_name").notNull(),
    lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.sequenceName] }),
  ],
);

export type WorkspaceSequence = typeof workspaceSequencesTable.$inferSelect;
export type InsertWorkspaceSequence = typeof workspaceSequencesTable.$inferInsert;
