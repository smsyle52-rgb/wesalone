import { pointPurchaseOrderService } from "@chatbotx.io/business"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { isPointPurchasesEnabled } from "@/env"
import { AdminPointPurchaseOrdersView } from "@/features/plans/admin-point-purchase-orders-view"

const STATUSES = ["under_review", "approved", "rejected", "cancelled"] as const

export default async function AdminPointPurchaseOrdersPage(props: {
  searchParams: Promise<{ status?: string }>
}) {
  if (!isPointPurchasesEnabled()) {
    notFound()
  }

  const t = await getTranslations()
  const searchParams = await props.searchParams
  const status = STATUSES.includes(
    searchParams.status as (typeof STATUSES)[number],
  )
    ? (searchParams.status as (typeof STATUSES)[number])
    : "under_review"

  const rows = await pointPurchaseOrderService.listForAdmin(status)
  const orders = rows.map((row) => ({
    order: row.order,
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    productNameEn: row.productNameEn,
    receiptUrl: row.receiptUrl,
  }))

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-bold text-lg sm:text-xl">
          {t("plans.pointPurchaseAdmin.title")}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t("plans.pointPurchaseAdmin.subtitle")}
        </p>
      </div>
      <AdminPointPurchaseOrdersView orders={orders} status={status} />
    </div>
  )
}
