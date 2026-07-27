"use client"

import type { WesalOnePlan } from "@chatbotx.io/business"
import { PricingTableFour } from "@chatbotx.io/ui/components/billingsdk/pricing-table-four"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import type { Plan } from "@chatbotx.io/ui/lib/billingsdk-config"
import { useLocale, useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"
import { applySandboxPlanAction } from "./actions/apply-sandbox-plan.action"
import type { SubscriptionPaymentSubmission } from "./subscription-payment-panel"
import { SubscriptionPaymentPanel } from "./subscription-payment-panel"

type PricingViewProps = {
  plans: readonly WesalOnePlan[]
  workspaceId: string
  paymentsEnabled: boolean
  submissions: SubscriptionPaymentSubmission[]
}

function getPlanButtonText(
  plan: WesalOnePlan,
  t: ReturnType<typeof useTranslations>,
): string {
  if (plan.priceMonthlyUsd === null) {
    return t("plans.contactSales")
  }
  if (plan.priceMonthlyUsd === 0) {
    return t("plans.selectFree")
  }
  return t("plans.selectPlan")
}

export function PricingView({
  plans,
  workspaceId,
  paymentsEnabled,
  submissions,
}: PricingViewProps) {
  const t = useTranslations()
  const locale = useLocale()
  const [openPlanSlug, setOpenPlanSlug] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">(
    "monthly",
  )

  const { execute, isPending } = useAction(
    applySandboxPlanAction.bind(null, workspaceId),
    {
      onSuccess: ({ data }) => {
        const plan = plans.find((p) => p.slug === data?.planSlug)
        toast.success(
          t("plans.toast.success", {
            plan: locale === "ar" ? (plan?.nameAr ?? "") : (plan?.nameEn ?? ""),
          }),
        )
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? t("plans.toast.error"))
      },
    },
  )

  const billingsdkPlans: Plan[] = plans.map((plan) => {
    const name = locale === "ar" ? plan.nameAr : plan.nameEn
    const isCustom = plan.priceMonthlyUsd === null
    const summary = isCustom
      ? t("plans.summaryCustom")
      : t("plans.summary", {
          channels: plan.limits.channels ?? "∞",
          contacts: plan.limits.contacts ?? "∞",
          teamMembers: plan.limits.teamMembers ?? "∞",
          points: plan.monthlyPoints ?? "∞",
        })

    return {
      id: plan.slug,
      title: name,
      description: summary,
      currency: "$",
      // A non-numeric string here (any locale) already suppresses the
      // currency-prefix in PricingTableFour via its `Number.parseFloat(...)
      // >= 0` guard, so this is safe to localize rather than needing the
      // literal English word "custom".
      monthlyPrice: isCustom ? t("plans.custom") : String(plan.priceMonthlyUsd),
      yearlyPrice: isCustom ? t("plans.custom") : String(plan.priceYearlyUsd),
      buttonText: getPlanButtonText(plan, t),
      badge: t(`plans.audience.${plan.audience}`),
      highlight: plan.highlighted,
      features: plan.features.map((slug) => ({
        name: t(`plans.features.${slug}`),
        icon: "check",
      })),
    }
  })

  return (
    <div className="space-y-4">
      {paymentsEnabled ? (
        <SubscriptionPaymentPanel
          billingCycle={billingCycle}
          onOpenChange={setOpenPlanSlug}
          openPlanSlug={openPlanSlug}
          plans={plans}
          submissions={submissions}
          workspaceId={workspaceId}
        />
      ) : (
        <>
          <div className="flex justify-center">
            <Badge variant="outline">{t("plans.sandboxBadge")}</Badge>
          </div>
          <p className="mx-auto max-w-2xl text-center text-muted-foreground text-sm">
            {t("plans.sandboxNotice")}
          </p>
        </>
      )}
      <PricingTableFour
        billingToggleLabels={{
          monthly: t("plans.monthly"),
          yearly: t("plans.yearly"),
        }}
        description={t("plans.description")}
        labels={{
          perMonth: t("plans.perMonth"),
          perYear: t("plans.perYear"),
        }}
        onPlanSelect={(planId, selectedBillingCycle) => {
          const plan = plans.find((p) => p.slug === planId)
          if (!plan || plan.priceMonthlyUsd === null) {
            return
          }
          if (paymentsEnabled) {
            setBillingCycle(selectedBillingCycle)
            setOpenPlanSlug(plan.slug)
            return
          }
          if (isPending) {
            return
          }
          execute({ planSlug: plan.slug })
        }}
        plans={billingsdkPlans}
        showBillingToggle
        size="medium"
        subtitle={t("plans.subtitle")}
        theme="classic"
        title={t("plans.title")}
      />
    </div>
  )
}
