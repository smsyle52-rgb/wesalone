import { userQuotaService, workspaceService } from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import { sendUsageLimitReached } from "@chatbotx.io/mail"
import { distributedLock } from "@chatbotx.io/redis"

const log = getChildLogger("notify-mac-limit-reached")

const SCAN_LIMIT = 100
const LOCK_TTL_SECONDS = 110

/**
 * Emails a merchant once per billing period when their monthly-active-contact
 * allowance runs out and `withBlockedOwnerGuard` starts skipping their jobs.
 *
 * Before this, that freeze was silent on every side: a single log line, no
 * word to the merchant and none to their customer, so an agent could go quiet
 * mid-conversation with nothing anywhere saying why.
 */
export async function notifyMacLimitReached(): Promise<void> {
  await distributedLock.runExclusive({
    key: "schedule:notify-mac-limit-reached",
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const owners =
        await userQuotaService.listOwnersNeedingMacBlockedNotice(SCAN_LIMIT)
      if (owners.length === 0) {
        return
      }

      let sent = 0
      for (const owner of owners) {
        try {
          const target = await workspaceService.findNotifiableOwner(
            owner.userId,
          )
          if (!target?.email) {
            // No address to reach them on. Stamp it anyway so the sweep does
            // not reconsider this owner every two minutes for the whole period.
            await userQuotaService.markMacBlockedNotified(owner.userId)
            continue
          }

          await sendUsageLimitReached(target.email, {
            subject: "توقّف الرد التلقائي — انتهت جهات الاتصال النشطة",
            brandName: "Wesal One",
            brandLogoUrl: `${process.env.NEXT_PUBLIC_BUILDER_URL ?? ""}/logo.png`,
            brandUrl: process.env.NEXT_PUBLIC_BUILDER_URL ?? "",
            workspaceName: target.workspaceName,
            planName: owner.planName ?? "الحالية",
            macLimit: owner.macLimit,
            upgradeUrl: `${process.env.NEXT_PUBLIC_BUILDER_URL ?? ""}/portal/pricing`,
          })

          // Only after the SMTP server accepted it, so a send failure leaves
          // the notice due and the next sweep retries it.
          await userQuotaService.markMacBlockedNotified(owner.userId)
          sent += 1
        } catch (err) {
          log.warn(
            { err, userId: owner.userId },
            "mac limit notice failed; will retry next sweep",
          )
        }
      }

      log.info({ scanned: owners.length, sent }, "mac limit notices processed")
    },
  })
}
