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
import { pointGrantStatuses, pointGrantTypes } from "../partials/point"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { pointWalletModel } from "./point-wallet"

export const pointGrantType = pgEnum(
  "pointGrantType",
  pointGrantTypes.options as [string, ...string[]],
)

export const pointGrantStatus = pgEnum(
  "pointGrantStatus",
  pointGrantStatuses.options as [string, ...string[]],
)

// One grant per credit event — a monthly plan renewal, a points purchase, an
// admin adjustment. `originalMicroPoints` never changes after creation;
// `remainingMicroPoints` is decremented by debitPointsFromWallet as the
// grant is spent (down to 0, at which point status flips to "exhausted").
// Micro-points (1 visible point = 1,000,000 micro-points, see the
// point-wallet service) give exact integer arithmetic across many small
// per-reply debits without ever exposing the internal precision to a
// merchant. `expiresAt` is null for points that never expire on their own
// (monthly grants instead lapse by no longer being renewed); purchased
// grants typically carry a real expiry.
export const pointGrantModel = pgTable(
  "PointGrant",
  {
    ...sharedColumns,
    walletId: bigintAsString()
      .notNull()
      .references(() => pointWalletModel.id, { onDelete: "cascade" }),
    grantType: pointGrantType().notNull(),
    originalMicroPoints: bigintAsString().notNull(),
    remainingMicroPoints: bigintAsString().notNull(),
    startsAt: timestamp(timestampConfig).defaultNow().notNull(),
    expiresAt: timestamp(timestampConfig),
    status: pointGrantStatus().default("active").notNull(),
    sourceType: text(),
    sourceId: text(),
    // Guarantees a grant is created at most once even if the caller (e.g. a
    // subscription-renewal job) retries after a timeout.
    idempotencyKey: text().notNull(),
    metadata: jsonb().default({}),
  },
  (table) => [
    check(
      "PointGrant_originalMicroPoints_nonnegative",
      sql`${table.originalMicroPoints} >= 0`,
    ),
    check(
      "PointGrant_remainingMicroPoints_nonnegative",
      sql`${table.remainingMicroPoints} >= 0`,
    ),
    check(
      "PointGrant_remaining_not_above_original",
      sql`${table.remainingMicroPoints} <= ${table.originalMicroPoints}`,
    ),
    uniqueIndex("PointGrant_idempotencyKey_key").on(table.idempotencyKey),
    index("PointGrant_walletId_status_idx").on(table.walletId, table.status),
    index("PointGrant_walletId_expiresAt_idx").on(
      table.walletId,
      table.expiresAt,
    ),
  ],
)
