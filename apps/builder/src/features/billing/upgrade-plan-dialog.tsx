"use client"

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chatbotx.io/ui/components/ui/dialog"
import { useTranslations } from "next-intl"
import { UpgradePlanButton } from "./upgrade-plan-button"

/**
 * MIT stand-in for upstream's `src/enterprise/features/billing/upgrade-plan-dialog`,
 * which is covered by the ChatbotX Commercial License and was removed from this
 * deployment (see upgrade-plan-button.tsx). Same props, so upstream call sites
 * only change their import; the dialog hands off to `/portal/pricing` instead of
 * embedding the private billing portal.
 */
export function UpgradePlanDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations()

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("actions.upgradePlan")}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <UpgradePlanButton onClick={() => onOpenChange(false)}>
            {t("billing.paidPlanRequired.cta")}
          </UpgradePlanButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
