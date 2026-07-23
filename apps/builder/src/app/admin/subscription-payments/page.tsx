import {
  findWesalOnePlan,
  platformSubscriptionPaymentService,
} from "@chatbotx.io/business"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { isPlatformSubscriptionPaymentsEnabled } from "@/env"
import { AdminSubscriptionPaymentsView } from "@/features/plans/admin-subscription-payments-view"

const STATUSES = ["under_review", "confirmed", "rejected", "cancelled"] as const

export default async function AdminSubscriptionPaymentsPage(props: {
  searchParams: Promise<{ status?: string }>
}) {
  if (!isPlatformSubscriptionPaymentsEnabled()) {
    notFound()
  }

  const [t, locale] = await Promise.all([getTranslations(), getLocale()])
  const searchParams = await props.searchParams
  const status = STATUSES.includes(
    searchParams.status as (typeof STATUSES)[number],
  )
    ? (searchParams.status as (typeof STATUSES)[number])
    : "under_review"

  const rows = await platformSubscriptionPaymentService.listForAdmin(status)
  // Resolved server-side (plan catalog is a business-layer value, not safe
  // to import at runtime from the client bundle — see
  // admin-subscription-payments-view.tsx's own note) and handed down as
  // plain strings.
  const submissions = rows.map((row) => {
    const plan = findWesalOnePlan(row.submission.planSlug)
    let planName = row.submission.planSlug
    if (plan) {
      planName = locale === "ar" ? plan.nameAr : plan.nameEn
    }
    return {
      ...row,
      planName,
      planPriceDisplay:
        plan?.priceMonthlyUsd == null ? "—" : `$${plan.priceMonthlyUsd}`,
    }
  })

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-bold text-lg sm:text-xl">
          {t("plans.admin.title")}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t("plans.admin.subtitle")}
        </p>
      </div>
      <AdminSubscriptionPaymentsView
        status={status}
        submissions={submissions}
      />
    </div>
  )
}
