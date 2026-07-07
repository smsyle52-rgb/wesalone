import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const domainEventsTable = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // W6-T2: end-to-end tracing — set on domain_events created from a live
    // webhook POST so the full webhook -> domain_event chain is grep-able by
    // one id. Null for events created outside that path (unthreaded).
    correlationId: uuid("correlation_id"),
  },
  (table) => [
    index("idx_domain_events_pending").on(table.status, table.createdAt),
    index("idx_domain_events_ws_type").on(table.workspaceId, table.eventType, table.createdAt),
    index("idx_domain_events_correlation").on(table.correlationId),
  ],
);

export type DomainEvent = typeof domainEventsTable.$inferSelect;
export type InsertDomainEvent = typeof domainEventsTable.$inferInsert;

// W4-T3: per-subscriber idempotent progress tracking for the event-dispatcher
// (EVENT_DISPATCHER flag). Independent of domain_events.status, which stays a
// single-consumer summary field for the legacy direct-loop path.
export const eventSubscriberProgressTable = pgTable(
  "event_subscriber_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => domainEventsTable.id, { onDelete: "cascade" }),
    subscriber: text("subscriber").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_event_subscriber_progress_event_subscriber").on(table.eventId, table.subscriber),
    index("idx_event_subscriber_progress_status").on(table.status),
  ],
);

export type EventSubscriberProgress = typeof eventSubscriberProgressTable.$inferSelect;
