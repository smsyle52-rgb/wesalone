import {
  classifyPointsBalance,
  pointWalletService,
  usageMeteringService,
  workspaceService,
} from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import {
  type PointsBalanceNoticeKind,
  sendPointsBalanceNotice,
} from "@chatbotx.io/mail"
import { distributedLock, distributedStore } from "@chatbotx.io/redis"

const log = getChildLogger("notify-points-balance")

const LOCK_TTL_SECONDS = 540
/** Owners whose balance is worth watching: anyone who ran AI recently. */
const ACTIVE_WINDOW_DAYS = 30
/** A sent notice is not repeated for this long unless the balance recovers. */
const NOTICE_TTL_SECONDS = 30 * 24 * 60 * 60

const noticeKey = (kind: PointsBalanceNoticeKind, userId: string) =>
  `points-balance-notice:${kind}:${userId}`

/**
 * Emails a workspace owner once when their AI points run low and once when
 * they run out, then stays quiet until the balance recovers (a top-up or the
 * next monthly grant clears the flags, so the next drop warns again).
 *
 * Only meaningful while points are enforced: in shadow mode nothing is ever
 * debited, so a "low" balance would be a false alarm.
 */
export async function notifyPointsBalance(): Promise<void> {
  if (!usageMeteringService.isEnforced()) {
    return
  }
  await distributedLock.runExclusive({
    key: "schedule:notify-points-balance",
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const owners =
        await usageMeteringService.listOwnersWithRecentUsage(ACTIVE_WINDOW_DAYS)
      let sent = 0
      for (const userId of owners) {
        try {
          const balance = await pointWalletService.getWalletBalance(userId)
          const kind = classifyPointsBalance(balance)
          if (!kind) {
            await distributedStore.delete([
              noticeKey("low", userId),
              noticeKey("depleted", userId),
            ])
            continue
          }
          if (await distributedStore.exists(noticeKey(kind, userId))) {
            continue
          }
          const target = await workspaceService.findNotifiableOwner(userId)
          if (target?.email) {
            const builderUrl = process.env.NEXT_PUBLIC_BUILDER_URL ?? ""
            await sendPointsBalanceNotice(target.email, {
              kind,
              subject:
                kind === "depleted"
                  ? "نفد رصيد نقاط الذكاء الاصطناعي — تحوّلت المحادثات إلى فريقك"
                  : "رصيد نقاط الذكاء الاصطناعي أوشك على النفاد",
              brandName: "Wesal One",
              brandLogoUrl: `${builderUrl}/logo.png`,
              brandUrl: builderUrl,
              workspaceName: target.workspaceName,
              availablePoints: balance.totalAvailablePoints,
              monthlyPoints: balance.monthlyGrantedPoints || null,
              topUpUrl: `${builderUrl}/portal/pricing`,
            })
            sent += 1
          }
          // Stamped after the SMTP server accepted it (or when there is no
          // address at all), so a send failure is retried on the next sweep.
          await distributedStore.put(
            noticeKey(kind, userId),
            1,
            NOTICE_TTL_SECONDS,
          )
        } catch (err) {
          log.warn(
            { err, userId },
            "points balance notice failed; will retry next sweep",
          )
        }
      }
      log.info(
        { scanned: owners.length, sent },
        "points balance notices processed",
      )
    },
  })
}
