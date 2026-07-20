import type { WalletBalance } from "@chatbotx.io/business"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@chatbotx.io/ui/components/ui/card"
import { Progress } from "@chatbotx.io/ui/components/ui/progress"
import { getTranslations } from "next-intl/server"

export async function PointsUsageCard({
  balance,
}: {
  balance: WalletBalance | null
}) {
  const t = await getTranslations()

  if (!balance || balance.totalAvailablePoints <= 0) {
    return null
  }

  const { monthlyPoints, purchasedPoints, frozenPoints, totalAvailablePoints } =
    balance
  const usedShareOfMonthly =
    monthlyPoints > 0
      ? Math.min(100, (monthlyPoints / totalAvailablePoints) * 100)
      : 0

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{t("plans.usage.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="font-bold text-3xl">
            {totalAvailablePoints.toLocaleString()}
          </div>
          <div className="text-muted-foreground text-sm">
            {t("plans.usage.available")}
          </div>
        </div>

        <Progress value={usedShareOfMonthly} />

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="font-semibold">
              {monthlyPoints.toLocaleString()}
            </div>
            <div className="text-muted-foreground">
              {t("plans.usage.monthly")}
            </div>
          </div>
          <div>
            <div className="font-semibold">
              {purchasedPoints.toLocaleString()}
            </div>
            <div className="text-muted-foreground">
              {t("plans.usage.purchased")}
            </div>
          </div>
          {frozenPoints > 0 && (
            <div>
              <div className="font-semibold">
                {frozenPoints.toLocaleString()}
              </div>
              <div className="text-muted-foreground">
                {t("plans.usage.frozen")}
              </div>
            </div>
          )}
        </div>

        {balance.nearestExpiry && (
          <p className="text-muted-foreground text-xs">
            {t("plans.usage.expiresOn", {
              date: new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
              }).format(balance.nearestExpiry),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
