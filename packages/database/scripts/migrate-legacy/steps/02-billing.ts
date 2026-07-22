// Step 2: old `payment_submissions` (submission_type='subscription') -> new
// `PlatformSubscriptionPayment`. Workspace-scoped in both systems, so this is
// the most directly portable billing table (see migration plan).
//
// `receiptFileId` is intentionally left null: the old receipt lives in the old
// system's file storage as a bare URL (`receipt_file_url`), and re-hosting the
// actual bytes into the new storage bucket is a separate concern this step
// does not attempt. What's preserved here is the ledger fact (who paid what,
// for what plan, and the reviewer's decision) — not the receipt image itself.
//
// `reviewedBy` only maps to a new User id if that old reviewer happens to be
// one of the workspace owners already migrated in Step 1 (via a read-only
// id-map lookup) — old admins/staff are out of Step 1's scope, so most
// reviewedBy values will legitimately come through as null rather than a
// fabricated/guessed identity.

import { db } from "../../../src/client"
import { platformSubscriptionPaymentModel } from "../../../src/schema"
import { getOrCreateId, peekId } from "../id-map"
import { fetchOldSubscriptionPayments } from "../old-db"
import type { WorkspaceMigrationResult } from "./01-workspaces"

const STATUS_MAP: Record<
  string,
  "under_review" | "confirmed" | "rejected" | "cancelled"
> = {
  confirmed: "confirmed",
  rejected: "rejected",
  cancelled: "cancelled",
  under_review: "under_review",
  pending: "under_review",
  pending_payment: "under_review",
}

const resolveStatus = (
  oldStatus: string,
): "under_review" | "confirmed" | "rejected" | "cancelled" => {
  const mapped = STATUS_MAP[oldStatus]
  if (!mapped) {
    console.warn(
      `Step 2: unrecognized payment status "${oldStatus}", defaulting to under_review`,
    )
    return "under_review"
  }
  return mapped
}

export const migrateSubscriptionPayments = async (
  workspaces: WorkspaceMigrationResult[],
) => {
  const newWorkspaceIdByOld = new Map(
    workspaces.map((w) => [w.oldWorkspaceId, w.newWorkspaceId]),
  )
  const payments = await fetchOldSubscriptionPayments()

  let migrated = 0
  let skipped = 0

  for (const payment of payments) {
    const newWorkspaceId = newWorkspaceIdByOld.get(payment.workspaceId)
    if (!newWorkspaceId) {
      skipped += 1
      continue
    }
    if (!payment.planSlug) {
      console.warn(
        `Step 2: payment ${payment.id} has no resolvable plan slug, skipping`,
      )
      skipped += 1
      continue
    }

    const reviewedByNewId = payment.reviewedBy
      ? peekId("user", payment.reviewedBy)
      : undefined

    await db
      .insert(platformSubscriptionPaymentModel)
      .values({
        // Deterministic id from the old payment id so a re-run (likely, given
        // the proxy-tunnel instability seen in Phase 2) dedups instead of
        // inserting a second copy of every payment.
        id: getOrCreateId("subscriptionPayment", payment.id),
        workspaceId: newWorkspaceId,
        planSlug: payment.planSlug,
        billingCycle: payment.billingCycle,
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        receiptNote: payment.receiptNote,
        rejectionReason: payment.rejectionReason,
        status: resolveStatus(payment.status),
        reviewedBy: reviewedByNewId,
        reviewedAt: payment.reviewedAt,
        createdAt: payment.createdAt,
      })
      .onConflictDoNothing({ target: platformSubscriptionPaymentModel.id })

    migrated += 1
  }

  if (skipped > 0) {
    console.warn(
      `Step 2: skipped ${skipped} payment(s) (unmigrated workspace or unresolved plan).`,
    )
  }
  console.log(
    `Step 2: migrated ${migrated}/${payments.length} subscription payment(s).`,
  )
}
