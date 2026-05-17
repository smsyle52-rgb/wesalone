import { index, pgTable, text, timestamp, uuid, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const outboxEventsTable = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_outbox_events_workspace_idempotency").on(table.workspaceId, table.idempotencyKey),
    index("idx_outbox_events_status").on(table.status, table.nextAttemptAt),
    index("idx_outbox_events_entity").on(table.entityType, table.entityId),
  ],
);

export type OutboxEvent = typeof outboxEventsTable.$inferSelect;
export type InsertOutboxEvent = typeof outboxEventsTable.$inferInsert;
