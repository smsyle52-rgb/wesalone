import { integer, pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core"
import { pointWalletStatuses } from "../partials/point"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { userModel } from "./auth-user"

export const pointWalletStatus = pgEnum(
  "pointWalletStatus",
  pointWalletStatuses.options as [string, ...string[]],
)

// One wallet per owning user — not per workspace. Mirrors UserQuota's
// owner-level pooling (see docs/tenancy.md#quota-enforcement): a reseller
// with several workspaces spends from one shared AI points pool, the same
// way they share one channels/contacts pool, instead of each workspace
// carrying its own fragment of the subscription's included points.
//
// The balance is never stored here — it is always computed live from the
// sum of this wallet's active PointGrant rows (see the point-wallet
// service's getWalletBalance). PointLedger is the append-only audit trail
// behind every change; this row only identifies the wallet and its status.
export const pointWalletModel = pgTable(
  "PointWallet",
  {
    ...sharedColumns,
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, { onDelete: "cascade" }),
    status: pointWalletStatus().default("active").notNull(),
    version: integer().default(0).notNull(),
  },
  (table) => [uniqueIndex("PointWallet_userId_key").on(table.userId)],
)
