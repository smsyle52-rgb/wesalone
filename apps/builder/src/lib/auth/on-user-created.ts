import type { AuthCreatedUser } from "@chatbotx.io/auth/server"
import { userQuotaService } from "@chatbotx.io/business"
import { QuotaJobAction, quotaQueue } from "@chatbotx.io/worker-config"
import { isCloud } from "@/env"
import { logger } from "@/lib/log"

/**
 * Wired into `createAuth` as the `onUserCreated` callback, so it fires once on
 * every sign-up path (email/password, social, magic link). On cloud it first
 * stamps a conservative bootstrap trial row, then enqueues a
 * `publishEntitlements` job on the BullMQ `quota` queue — the cross-repo
 * contract the private `quota-worker` consumes to reconcile the new user's
 * authoritative entitlement snapshot. The contract is the queue name + job
 * shape only; no enterprise package is imported here. Anonymous-plugin users
 * are skipped — they're throwaway accounts that shouldn't get a subscription.
 *
 * Best-effort: the bootstrap row closes the sign-up-to-worker gap; the
 * fail-open `entitlements:default-plan` overlay is now only a secondary
 * last-resort fallback. Failures are logged and swallowed and never block
 * sign-up. The backfill job reconciles anything missed here.
 */
export async function onUserCreated(user: AuthCreatedUser): Promise<void> {
  if (user.isAnonymous) {
    return
  }

  // The bootstrap row is stamped on every edition, not only cloud. Upstream's
  // `!isCloud()` return is correct for a self-hosted install serving its own
  // owner — no quota row means unlimited, which is what that operator wants.
  // Wesal One runs the community edition but IS the platform for its
  // merchants, so the same return left every sign-up with no plan, no wallet
  // and no balance. The early return inside `ensureBootstrapPlan` was removed
  // for exactly this reason; this caller still guarded the call, so the fix
  // never ran. Measured 8 Sep 2026: 1 of 44 September sign-ups had a plan,
  // against 39 of 74 in July.
  let bootstrapError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await userQuotaService.ensureBootstrapPlan({
        userId: user.id,
        tenantId: user.tenantId,
      })
      bootstrapError = undefined
      break
    } catch (err) {
      bootstrapError = err
    }
  }
  if (bootstrapError) {
    logger.warn(
      { err: bootstrapError, userId: user.id, attempts: 3 },
      "Failed to stamp bootstrap billing state on sign-up",
    )
  }

  // The queue half stays cloud-only: `publishEntitlements` is a cross-repo
  // contract consumed by the private `quota-worker`, which does not run here.
  // Enqueuing it off-cloud would pile up jobs nothing consumes.
  if (!isCloud()) {
    return
  }

  try {
    await quotaQueue.add(QuotaJobAction.publishEntitlements, {
      type: QuotaJobAction.publishEntitlements,
      data: { userId: user.id },
    })
  } catch (err) {
    logger.warn(
      { err, userId: user.id },
      "Failed to enqueue entitlement publish on sign-up",
    )
  }
}
