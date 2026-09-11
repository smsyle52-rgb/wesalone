import { platformSubscriptionService } from "@chatbotx.io/business"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@chatbotx.io/ui/components/ui/alert"
import { buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import { LockIcon } from "lucide-react"
import Link from "next/link"
import { getTranslations } from "next-intl/server"

interface PaidPlanRequiredBannerProps {
  workspaceId: string
  feature: "broadcasts" | "contactImport"
}

/**
 * Explains up front that broadcasts / contact import need a paid plan, so a
 * free merchant is not left to discover it from a rejected submit. The actual
 * gate is `platformSubscriptionService.assertPaidPlanForWorkspace` server-side.
 */
export async function PaidPlanRequiredBanner({
  workspaceId,
  feature,
}: PaidPlanRequiredBannerProps) {
  if (await platformSubscriptionService.hasPaidPlanForWorkspace(workspaceId)) {
    return null
  }

  const t = await getTranslations("billing.paidPlanRequired")

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5" variant="warning">
      <LockIcon />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          {t(
            feature === "broadcasts"
              ? "broadcastsDescription"
              : "contactImportDescription",
          )}
        </p>
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href="/portal/pricing"
        >
          {t("cta")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}
