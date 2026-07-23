import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { pointLedgerTransactionTypes } from "../partials/point"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { pointGrantModel } from "./point-grant"
import { pointWalletModel } from "./point-wallet"

export const pointLedgerTransactionType = pgEnum(
  "pointLedgerTransactionType",
  pointLedgerTransactionTypes.options as [string, ...string[]],
)

// Append-only audit trail — rows are never updated or deleted, only
// inserted. `microPoints` is signed (positive = credit, negative = debit) so
// summing a wallet's ledger rows independently reproduces the same balance
// PointGrant.remainingMicroPoints already tracks; the two are kept in sync
// by always writing both inside the same transaction (see
// debitPointsFromWallet / createGrant in the point-wallet service).
// `idempotencyKey` is what makes a retried debit or grant a safe no-op
// instead of a double-charge.
export const pointLedgerModel = pgTable(
  "PointLedger",
  {
    ...sharedColumns,
    walletId: bigintAsString()
      .notNull()
      .references(() => pointWalletModel.id, { onDelete: "cascade" }),
    grantId: bigintAsString().references(() => pointGrantModel.id, {
      onDelete: "set null",
    }),
    transactionType: pointLedgerTransactionType().notNull(),
    microPoints: bigintAsString().notNull(),
    sourceType: text(),
    sourceId: text(),
    idempotencyKey: text().notNull(),
    reason: text(),
    actorType: text(),
    actorId: text(),
    metadata: jsonb().default({}),
  },
  (table) => [
    uniqueIndex("PointLedger_idempotencyKey_key").on(table.idempotencyKey),
    index("PointLedger_walletId_createdAt_idx").on(
      table.walletId,
      table.createdAt,
    ),
    index("PointLedger_grantId_idx").on(table.grantId),
  ],
)
