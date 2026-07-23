import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { sharedColumns, timestampConfig } from "../partials/shared"

// Purchasable point bundle catalog — admin-editable, not hardcoded like the
// plan catalog. `allowedPlanSlugs` empty = available to every paid plan.
export const pointTopupProductModel = pgTable(
  "PointTopupProduct",
  {
    ...sharedColumns,
    slug: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    descriptionAr: text(),
    descriptionEn: text(),
    points: integer().notNull(),
    priceCents: integer().notNull(),
    currency: text().default("USD").notNull(),
    isActive: boolean().default(true).notNull(),
    sortOrder: integer().default(100).notNull(),
    allowedPlanSlugs: text().array().default([]).notNull(),
    effectiveFrom: timestamp(timestampConfig),
    effectiveUntil: timestamp(timestampConfig),
  },
  (table) => [uniqueIndex("PointTopupProduct_slug_key").on(table.slug)],
)
