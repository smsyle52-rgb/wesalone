import {
  platformSubscriptionService,
  usageMeteringService,
} from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import { distributedLock } from "@chatbotx.io/redis"

const log = getChildLogger("process-billing-lifecycle")

export async function processBillingLifecycle(): Promise<void> {
  await distributedLock.runExclusive({
    key: "schedule:process-billing-lifecycle",
    timeoutInSeconds: 240,
    fn: async () => {
      const ids = await platformSubscriptionService.listDue(100)
      let granted = 0
      for (const id of ids) {
        if (await platformSubscriptionService.processDueMonthlyGrant(id)) {
          granted += 1
        }
      }
      const releasedReservations =
        await usageMeteringService.releaseStaleReservations()
      const reconciledSettlements =
        await usageMeteringService.retryPendingSettlements()
      log.info(
        {
          scanned: ids.length,
          granted,
          releasedReservations,
          reconciledSettlements,
        },
        "billing lifecycle processed",
      )
    },
  })
}
