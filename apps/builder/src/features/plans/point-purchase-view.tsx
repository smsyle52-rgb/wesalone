"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@chatbotx.io/ui/components/ui/card"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import {
  type PointPurchaseOrderRow,
  PointPurchasePanel,
  type PointTopupProductOption,
} from "./point-purchase-panel"

type Props = {
  workspaceId: string
  products: PointTopupProductOption[]
  orders: PointPurchaseOrderRow[]
}

export function PointPurchaseView({ workspaceId, products, orders }: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const [openProductSlug, setOpenProductSlug] = useState<string | null>(null)

  if (products.length === 0) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <h3 className="font-bold text-base">{t("plans.pointPurchase.title")}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {products.map((product) => (
          <Card key={product.slug}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {locale === "ar" ? product.nameAr : product.nameEn}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="font-bold text-2xl">
                  {product.points.toLocaleString()}
                </div>
                <div className="text-muted-foreground text-xs">
                  {t("plans.pointPurchase.pointsLabel")}
                </div>
              </div>
              <div className="font-semibold text-sm">
                ${(product.priceCents / 100).toFixed(2)}
              </div>
              <Button
                className="w-full"
                onClick={() => setOpenProductSlug(product.slug)}
                size="sm"
              >
                {t("plans.pointPurchase.buyButton")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <PointPurchasePanel
        onOpenChange={setOpenProductSlug}
        openProductSlug={openProductSlug}
        orders={orders}
        products={products}
        workspaceId={workspaceId}
      />
    </div>
  )
}
