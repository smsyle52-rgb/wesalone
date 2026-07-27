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
  usageSummary,
}: {
  balance: WalletBalance | null
  usageSummary: Array<{ category: string; points: number; operations: number }>
}) {
  const t = await getTranslations()

  if (!balance || balance.totalAvailablePoints <= 0) {
    return null
  }

  const {
    monthlyPoints,
    monthlyGrantedPoints,
    monthlyUsedPoints,
    purchasedPoints,
    reservedPoints,
    frozenPoints,
    totalAvailablePoints,
  } = balance
  const usedShareOfMonthly =
    monthlyGrantedPoints > 0
      ? Math.min(100, (monthlyUsedPoints / monthlyGrantedPoints) * 100)
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

        <p className="text-muted-foreground text-xs">
          {monthlyUsedPoints.toLocaleString()} /{" "}
          {monthlyGrantedPoints.toLocaleString()}
        </p>

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="font-semibold">
              {monthlyPoints.toLocaleString()}
            </div>
            <div className="text-muted-foreground">
              {t("plans.usage.monthly")}
            </div>
          </div>
          {reservedPoints > 0 && (
            <div>
              <div className="font-semibold">
                {reservedPoints.toLocaleString()}
              </div>
              <div className="text-muted-foreground">
                {t("plans.usage.reserved")}
              </div>
            </div>
          )}
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

        {usageSummary.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="font-semibold text-sm">
              {t("plans.usage.breakdown")}
            </p>
            {usageSummary.map((item) => (
              <div
                className="flex items-center justify-between text-sm"
                key={item.category}
              >
                <span className="text-muted-foreground">
                  {t(`plans.usage.categories.${item.category}`)}
                </span>
                <span className="font-medium">
                  {item.points.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
