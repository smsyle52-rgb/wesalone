import { sql } from "drizzle-orm"
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  billableUsageCategories,
  billableUsageStatuses,
} from "../partials/billable-usage"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { pointWalletModel } from "./point-wallet"
import { workspaceModel } from "./workspace"

export const billableUsageStatus = pgEnum(
  "billableUsageStatus",
  billableUsageStatuses.options as [string, ...string[]],
)
export const billableUsageCategory = pgEnum(
  "billableUsageCategory",
  billableUsageCategories.options as [string, ...string[]],
)

// Durable reservation and settlement record. PointGrant remains the balance
// authority; this table prevents concurrent overspend and explains every AI
// charge by operation, model, rate version and raw provider usage.
export const billableUsageEventModel = pgTable(
  "BillableUsageEvent",
  {
    ...sharedColumns,
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, { onDelete: "cascade" }),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, { onDelete: "cascade" }),
    walletId: bigintAsString()
      .notNull()
      .references(() => pointWalletModel.id, { onDelete: "cascade" }),
    operationId: text().notNull(),
    category: billableUsageCategory().notNull(),
    status: billableUsageStatus().default("reserved").notNull(),
    provider: text(),
    model: text(),
    rateVersion: text().notNull(),
    reservedMicroPoints: bigintAsString().notNull(),
    settledMicroPoints: bigintAsString(),
    actualCostMicroUsd: bigintAsString(),
    inputUnits: bigintAsString(),
    outputUnits: bigintAsString(),
    cachedInputUnits: bigintAsString(),
    reasoningUnits: bigintAsString(),
    usage: jsonb().default({}),
    metadata: jsonb().default({}),
    settledAt: timestamp(timestampConfig),
    releasedAt: timestamp(timestampConfig),
    error: text(),
  },
  (table) => [
    check(
      "BillableUsageEvent_reservedMicroPoints_nonnegative",
      sql`${table.reservedMicroPoints} >= 0`,
    ),
    check(
      "BillableUsageEvent_settledMicroPoints_nonnegative",
      sql`${table.settledMicroPoints} IS NULL OR ${table.settledMicroPoints} >= 0`,
    ),
    check(
      "BillableUsageEvent_actualCostMicroUsd_nonnegative",
      sql`${table.actualCostMicroUsd} IS NULL OR ${table.actualCostMicroUsd} >= 0`,
    ),
    uniqueIndex("BillableUsageEvent_operationId_key").on(table.operationId),
    index("BillableUsageEvent_workspaceId_createdAt_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("BillableUsageEvent_walletId_status_idx").on(
      table.walletId,
      table.status,
    ),
    index("BillableUsageEvent_status_createdAt_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
)
