import {
  classifyPointsBalance,
  pointWalletService,
  usageMeteringService,
} from "@chatbotx.io/business"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@chatbotx.io/ui/components/ui/alert"
import { buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import { CoinsIcon } from "lucide-react"
import Link from "next/link"
import { getFormatter, getTranslations } from "next-intl/server"
import { logger } from "@/lib/log"

/**
 * Warns the merchant inside the dashboard when the workspace owner's AI points
 * run low or out — the same thresholds as the owner email
 * (`classifyPointsBalance`). Out of points means the agent hands every new
 * conversation to the team, so the merchant must not learn it from customers.
 *
 * Silent unless points are enforced: in shadow mode nothing is debited.
 */
export async function PointsBalanceBanner({
  ownerId,
  workspaceId,
}: {
  ownerId: string
  workspaceId: string
}) {
  if (!usageMeteringService.isEnforced()) {
    return null
  }

  let balance: Awaited<ReturnType<typeof pointWalletService.getWalletBalance>>
  try {
    balance = await pointWalletService.getWalletBalance(ownerId)
  } catch (error) {
    // A banner must never take the workspace down with it.
    logger.warn({ err: error, workspaceId }, "points balance banner failed")
    return null
  }

  const status = classifyPointsBalance(balance)
  if (!status) {
    return null
  }

  const t = await getTranslations(
    status === "depleted" ? "billing.pointsDepleted" : "billing.pointsLow",
  )
  const format = await getFormatter()

  return (
    <Alert
      className={
        status === "depleted"
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-500/40 bg-amber-500/5"
      }
      variant={status === "depleted" ? "destructive" : "warning"}
    >
      <CoinsIcon />
      <AlertTitle>{t("bannerTitle")}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          {t("bannerDescription", {
            available: format.number(Math.floor(balance.totalAvailablePoints)),
          })}
        </p>
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`/space/${workspaceId}/pricing`}
        >
          {t("bannerCta")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}
