import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { conversationsTable } from "./conversations";
import { aiAgentsTable } from "./ai";

export type AgentMemoryTurn = {
  role: "system" | "user" | "assistant";
  content: string;
  ts: string;
  message_id?: string | null;
};

export const agentMemorySnapshotsTable = pgTable(
  "agent_memory_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => aiAgentsTable.id, { onDelete: "set null" }),
    summary: text("summary"),
    recentTurns: jsonb("recent_turns").$type<AgentMemoryTurn[]>().notNull().default([]),
    lastMessageId: uuid("last_message_id"),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_memory_conv_agent").on(table.conversationId, table.agentId),
    index("idx_memory_ws_conv").on(table.workspaceId, table.conversationId),
  ],
);

export type AgentMemorySnapshot = typeof agentMemorySnapshotsTable.$inferSelect;
export type InsertAgentMemorySnapshot = typeof agentMemorySnapshotsTable.$inferInsert;
