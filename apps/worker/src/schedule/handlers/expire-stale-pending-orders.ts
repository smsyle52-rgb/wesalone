import { orderService } from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import { distributedLock } from "@chatbotx.io/redis"

const log = getChildLogger("expire-stale-pending-orders")
// Shorter than the 1-minute cron cadence, so two overlapping ticks (a slow
// run plus the next scheduled one) cannot both hold the lock at once.
const LOCK_TTL_SECONDS = 45
const BATCH_SIZE = 100

export async function expireStalePendingOrders(): Promise<void> {
  await distributedLock.runExclusive({
    key: "schedule:expire-stale-pending-orders",
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const { expiredCount, processedCount } =
        await orderService.expireStalePendingOrders({ batchSize: BATCH_SIZE })

      if (processedCount > 0) {
        log.info(
          { expiredCount, processedCount },
          "expireStalePendingOrders: batch processed",
        )
      }
    },
  })
}
