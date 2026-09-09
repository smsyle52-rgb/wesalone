"use client"

import type { OrderStatusType } from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"
import {
  cancelOrderAction,
  confirmOrderAction,
} from "./actions/confirm-order.action"

/**
 * Confirm / cancel for an order the AI agent drafted.
 *
 * Shown only on `draft` and `confirmed`: every later state involves money or a
 * finished order, and this pair must never look like a way to undo one.
 */
export function OrderActions({
  workspaceId,
  orderId,
  status,
}: {
  workspaceId: string
  orderId: string
  status: OrderStatusType
}) {
  const t = useTranslations()
  const router = useRouter()

  const confirm = useAction(
    confirmOrderAction.bind(null, workspaceId, orderId),
    {
      onSuccess: () => {
        toast.success(t("orders.actions.confirmed"))
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(error.serverError ?? t("messages.somethingWentWrong")),
    },
  )

  const cancel = useAction(cancelOrderAction.bind(null, workspaceId, orderId), {
    onSuccess: () => {
      toast.success(t("orders.actions.cancelled"))
      router.refresh()
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? t("messages.somethingWentWrong")),
  })

  if (status !== "draft" && status !== "confirmed") {
    return null
  }

  const busy = confirm.isPending || cancel.isPending

  return (
    <div className="ms-auto flex items-center gap-2">
      {status === "draft" && (
        <Button disabled={busy} onClick={() => confirm.execute()} size="sm">
          {confirm.isPending ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <CheckIcon />
          )}
          {t("orders.actions.confirm")}
        </Button>
      )}
      <Button
        disabled={busy}
        onClick={() => cancel.execute()}
        size="sm"
        variant="outline"
      >
        {cancel.isPending ? <Loader2Icon className="animate-spin" /> : <XIcon />}
        {t("orders.actions.cancel")}
      </Button>
    </div>
  )
}
