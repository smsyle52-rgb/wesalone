import { jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const sectorProfilesTable = pgTable(
  "sector_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sectorKey: text("sector_key").notNull(),
    nameAr: text("name_ar").notNull(),
    descriptionAr: text("description_ar").notNull(),
    baseKnowledge: jsonb("base_knowledge").$type<Record<string, unknown>>().notNull().default({}),
    behaviorProfile: jsonb("behavior_profile").$type<Record<string, unknown>>().notNull().default({}),
    serviceGoals: jsonb("service_goals").$type<Record<string, unknown>>().notNull().default({}),
    defaultTone: text("default_tone").notNull().default("مهني وودود"),
    guardrails: jsonb("guardrails").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_sector_profiles_key").on(table.sectorKey),
  ],
);

export type SectorProfile = typeof sectorProfilesTable.$inferSelect;
export type InsertSectorProfile = typeof sectorProfilesTable.$inferInsert;
