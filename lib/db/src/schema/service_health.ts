import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const serviceHeartbeatsTable = pgTable("service_heartbeats", {
  serviceName: text("service_name").primaryKey(),
  lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull().defaultNow(),
  version: text("version"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export type ServiceHeartbeat = typeof serviceHeartbeatsTable.$inferSelect;
