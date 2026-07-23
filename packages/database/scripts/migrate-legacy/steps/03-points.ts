// Step 3: old `point_wallets` + `point_grants` + `point_ledger` -> new
// `PointWallet` + `PointGrant` + `PointLedger`.
//
// Ownership pivot (the one real structural difference, per the migration
// plan): NEW pools points per OWNER across all their workspaces, one wallet
// per user. OLD has one wallet per workspace. For the 13 real workspaces this
// is a clean 1:1 mapping as long as no owner has more than one of them — if
// they do, their old wallets are pooled into the single new wallet, with the
// most restrictive status winning (suspended > frozen > active) so pooling
// never silently re-activates a wallet that was suspended for cause.
//
// Micro-point amounts copy straight across — both systems already use the
// same 1,000,000-micro-per-visible-point convention (confirmed by reading the
// actual old column definitions, not assumed). Grant/ledger enum values are
// also identical strings in both schemas, so no value-translation table is
// needed, only a light validation pass.

import { db } from "../../../src/client"
import {
  pointGrantModel,
  pointLedgerModel,
  pointWalletModel,
} from "../../../src/schema"
import { BATCH_SIZE, chunk } from "../batch"
import { getOrCreateId, peekId } from "../id-map"
import {
  fetchOldPointGrants,
  fetchOldPointLedger,
  fetchOldPointWallets,
} from "../old-db"
import type { WorkspaceMigrationResult } from "./01-workspaces"

const WALLET_STATUSES = ["active", "frozen", "suspended"] as const
const GRANT_TYPES = [
  "monthly_subscription",
  "purchased",
  "admin_adjustment",
  "refund",
  "promotional",
] as const
const GRANT_STATUSES = [
  "active",
  "exhausted",
  "expired",
  "frozen",
  "reversed",
] as const
const LEDGER_TYPES = [
  "credit",
  "debit",
  "expiration",
  "reversal",
  "refund",
  "admin_adjustment",
] as const

const restrictiveness: Record<(typeof WALLET_STATUSES)[number], number> = {
  active: 0,
  frozen: 1,
  suspended: 2,
}

const validate = <T extends string>(
  allowed: readonly T[],
  value: string,
  fallback: T,
  label: string,
): T => {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T
  }
  console.warn(
    `Step 3: unrecognized ${label} "${value}", defaulting to "${fallback}"`,
  )
  return fallback
}

export const migratePoints = async (workspaces: WorkspaceMigrationResult[]) => {
  const ownerByOldWorkspaceId = new Map(
    workspaces.map((w) => [w.oldWorkspaceId, w.newOwnerUserId]),
  )

  // ── Wallets: pool per new owner, most-restrictive status wins ──
  const oldWallets = await fetchOldPointWallets()
  const pooledStatusByOwner = new Map<
    string,
    (typeof WALLET_STATUSES)[number]
  >()
  const oldWalletIdToNewWalletId = new Map<string, string>()

  for (const wallet of oldWallets) {
    const ownerId = ownerByOldWorkspaceId.get(wallet.workspaceId)
    if (!ownerId) {
      continue
    }
    const status = validate(
      WALLET_STATUSES,
      wallet.status,
      "active",
      "wallet status",
    )
    const current = pooledStatusByOwner.get(ownerId)
    if (!current || restrictiveness[status] > restrictiveness[current]) {
      pooledStatusByOwner.set(ownerId, status)
    }
    oldWalletIdToNewWalletId.set(
      wallet.id,
      getOrCreateId("pointWallet", ownerId),
    )
  }

  for (const [ownerId, status] of pooledStatusByOwner) {
    await db
      .insert(pointWalletModel)
      .values({
        id: getOrCreateId("pointWallet", ownerId),
        userId: ownerId,
        status,
      })
      .onConflictDoNothing({ target: pointWalletModel.id })
  }
  console.log(
    `Step 3: migrated ${pooledStatusByOwner.size} wallet(s) (pooled from ${oldWallets.length} old wallet(s)).`,
  )

  // ── Grants ──
  const oldGrants = await fetchOldPointGrants()
  const grantRows = oldGrants.flatMap((grant) => {
    const newWalletId = oldWalletIdToNewWalletId.get(grant.walletId)
    if (!newWalletId) {
      return []
    }
    return [
      {
        id: getOrCreateId("pointGrant", grant.id),
        walletId: newWalletId,
        grantType: validate(
          GRANT_TYPES,
          grant.grantType,
          "admin_adjustment",
          "grant type",
        ),
        originalMicroPoints: grant.originalMicroPoints,
        remainingMicroPoints: grant.remainingMicroPoints,
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
        status: validate(
          GRANT_STATUSES,
          grant.status,
          "active",
          "grant status",
        ),
        sourceType: grant.sourceType,
        sourceId: grant.sourceId,
        idempotencyKey: `legacy-import:grant:${grant.id}`,
        createdAt: grant.createdAt,
      },
    ]
  })
  for (const rows of chunk(grantRows, BATCH_SIZE)) {
    await db
      .insert(pointGrantModel)
      .values(rows)
      .onConflictDoNothing({ target: pointGrantModel.id })
  }
  console.log(
    `Step 3: migrated ${grantRows.length}/${oldGrants.length} point grant(s).`,
  )

  // ── Ledger (append-only audit trail) ──
  const oldLedger = await fetchOldPointLedger()
  const ledgerRows = oldLedger.flatMap((entry) => {
    const newWalletId = oldWalletIdToNewWalletId.get(entry.walletId)
    if (!newWalletId) {
      return []
    }
    return [
      {
        id: getOrCreateId("pointLedger", entry.id),
        walletId: newWalletId,
        // Read-only lookup on purpose: a ledger row must only reference a grant
        // that was actually migrated (grants run first, above), never fabricate
        // a new mapping here — that would create a dangling FK on insert.
        grantId: entry.grantId
          ? peekId("pointGrant", entry.grantId)
          : undefined,
        transactionType: validate(
          LEDGER_TYPES,
          entry.transactionType,
          "admin_adjustment",
          "ledger transaction type",
        ),
        microPoints: entry.microPoints,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        idempotencyKey: `legacy-import:ledger:${entry.id}`,
        reason: entry.reason,
        actorType: entry.actorType,
        actorId: entry.actorId,
        createdAt: entry.createdAt,
      },
    ]
  })
  for (const rows of chunk(ledgerRows, BATCH_SIZE)) {
    await db
      .insert(pointLedgerModel)
      .values(rows)
      .onConflictDoNothing({ target: pointLedgerModel.id })
  }
  console.log(
    `Step 3: migrated ${ledgerRows.length}/${oldLedger.length} ledger entr(y/ies).`,
  )
}
