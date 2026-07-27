import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  platformSubscriptionSources,
  platformSubscriptionStatuses,
} from "../partials/platform-subscription"
import { platformSubscriptionBillingCycles } from "../partials/platform-subscription-payment"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const platformSubscriptionStatus = pgEnum(
  "platformSubscriptionStatus",
  platformSubscriptionStatuses.options as [string, ...string[]],
)
export const platformSubscriptionSource = pgEnum(
  "platformSubscriptionSource",
  platformSubscriptionSources.options as [string, ...string[]],
)
export const platformSubscriptionBillingCycle = pgEnum(
  "platformSubscriptionBillingCycle",
  platformSubscriptionBillingCycles.options as [string, ...string[]],
)

// Canonical owner-level subscription state. UserQuota is the fast enforcement
// projection; it is deliberately not the source of truth for lifecycle state.
export const platformSubscriptionModel = pgTable(
  "PlatformSubscription",
  {
    ...sharedColumns,
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, { onDelete: "cascade" }),
    workspaceId: bigintAsString().references(() => workspaceModel.id, {
      onDelete: "set null",
    }),
    planSlug: text().notNull(),
    billingCycle: platformSubscriptionBillingCycle().notNull(),
    status: platformSubscriptionStatus().default("active").notNull(),
    source: platformSubscriptionSource().notNull(),
    periodStart: timestamp(timestampConfig).notNull(),
    periodEnd: timestamp(timestampConfig).notNull(),
    nextGrantAt: timestamp(timestampConfig).notNull(),
    cancelAtPeriodEnd: boolean().default(false).notNull(),
    priceCents: integer().default(0).notNull(),
    currency: text().default("USD").notNull(),
    priceVersion: text().notNull(),
  },
  (table) => [
    uniqueIndex("PlatformSubscription_userId_key").on(table.userId),
    index("PlatformSubscription_status_nextGrantAt_idx").on(
      table.status,
      table.nextGrantAt,
    ),
    index("PlatformSubscription_periodEnd_idx").on(table.periodEnd),
  ],
)
