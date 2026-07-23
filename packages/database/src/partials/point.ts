import z from "zod"

// Wallet lifecycle. "frozen" holds purchased points untouched (see
// freezePurchasedGrants in the point-wallet service) when an owner downgrades
// to a plan with no paid points — the points are not lost, just unusable
// until the owner upgrades again. "suspended" is an admin-only override.
export const pointWalletStatuses = z.enum(["active", "frozen", "suspended"])
export type PointWalletStatus = z.infer<typeof pointWalletStatuses>

// Where a grant's points came from. "monthly_subscription" grants are always
// depleted before any other type (see debitPointsFromWallet ordering) so
// plan-included points expire with the billing period instead of being
// undercut by points a merchant paid extra for.
export const pointGrantTypes = z.enum([
  "monthly_subscription",
  "purchased",
  "admin_adjustment",
  "refund",
  "promotional",
])
export type PointGrantType = z.infer<typeof pointGrantTypes>

export const pointGrantStatuses = z.enum([
  "active",
  "exhausted",
  "expired",
  "frozen",
  "reversed",
])
export type PointGrantStatus = z.infer<typeof pointGrantStatuses>

// Ledger rows are append-only history, never edited — a mistake is corrected
// with an offsetting "reversal" row, not a mutation of the original.
export const pointLedgerTransactionTypes = z.enum([
  "credit",
  "debit",
  "expiration",
  "reversal",
  "refund",
  "admin_adjustment",
])
export type PointLedgerTransactionType = z.infer<
  typeof pointLedgerTransactionTypes
>

// A purchase order's lifecycle from claim to credited grant (or refund).
// "pending_payment" -> merchant hasn't submitted proof yet; "under_review"
// -> proof submitted, awaiting admin; "approved" -> credited, see
// PointPurchaseOrder.creditedGrantId; "expired" is a stale pending_payment
// order, not a rejection.
export const pointPurchaseOrderStatuses = z.enum([
  "pending_payment",
  "under_review",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "refunded",
  "chargeback",
])
export type PointPurchaseOrderStatus = z.infer<
  typeof pointPurchaseOrderStatuses
>
