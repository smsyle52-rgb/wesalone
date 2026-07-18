"use client"

import type { PlatformSubscriptionPaymentModel } from "@chatbotx.io/database/types"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@chatbotx.io/ui/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chatbotx.io/ui/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chatbotx.io/ui/components/ui/table"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"
import { confirmSubscriptionPaymentAction } from "./actions/confirm-subscription-payment.action"
import { rejectSubscriptionPaymentAction } from "./actions/reject-subscription-payment.action"

// planName/planPriceDisplay are resolved server-side (page.tsx) and handed
// down as plain strings — this file must NEVER import findWesalOnePlan or
// anything else at runtime from @chatbotx.io/business: that package's root
// barrel re-exports server-only modules (e.g. BullMQ-backed tag sync), and
// pulling it into a "use client" bundle breaks the browser build with a
// "Can't resolve 'worker_threads'" error. Type-only imports are still fine.
export type AdminSubmissionRow = {
  submission: PlatformSubscriptionPaymentModel
  workspaceName: string
  ownerName: string | null
  ownerEmail: string | null
  receiptUrl: string | null
  planName: string
  planPriceDisplay: string
}

type Props = {
  status: string
  submissions: AdminSubmissionRow[]
}

const STATUS_OPTIONS = [
  "under_review",
  "confirmed",
  "rejected",
  "cancelled",
  "all",
] as const

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 break-words font-medium text-sm">{value}</p>
    </div>
  )
}

export function AdminSubscriptionPaymentsView({ status, submissions }: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [selected, setSelected] = useState<AdminSubmissionRow | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const { execute: confirmPayment, isPending: isConfirming } = useAction(
    confirmSubscriptionPaymentAction,
    {
      onSuccess: () => {
        toast.success(t("plans.admin.toast.confirmed"))
        setSelected(null)
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(error.serverError ?? t("plans.admin.toast.confirmError")),
    },
  )

  const { execute: rejectPayment, isPending: isRejecting } = useAction(
    rejectSubscriptionPaymentAction,
    {
      onSuccess: () => {
        toast.success(t("plans.admin.toast.rejected"))
        setSelected(null)
        setRejectReason("")
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(error.serverError ?? t("plans.admin.toast.rejectError")),
    },
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm">
          {t("plans.admin.statusFilter")}
        </span>
        <Select
          onValueChange={(value) =>
            router.push(`/admin/subscription-payments?status=${value}`)
          }
          value={status}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all"
                  ? t("plans.admin.statusAll")
                  : t(`plans.subscriptionPayment.status.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          {t("plans.admin.empty")}
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("plans.admin.table.workspace")}</TableHead>
                <TableHead>{t("plans.admin.table.owner")}</TableHead>
                <TableHead>{t("plans.admin.table.plan")}</TableHead>
                <TableHead>{t("plans.admin.table.price")}</TableHead>
                <TableHead>{t("plans.admin.table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((row) => (
                <TableRow
                  className="cursor-pointer"
                  key={row.submission.id}
                  onClick={() => setSelected(row)}
                >
                  <TableCell>
                    <div className="font-medium">{row.workspaceName}</div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(row.submission.createdAt).toLocaleDateString(
                        locale,
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{row.ownerName ?? "—"}</div>
                    <div className="text-muted-foreground text-xs" dir="ltr">
                      {row.ownerEmail ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>{row.planName}</TableCell>
                  <TableCell>{row.planPriceDisplay}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(
                        `plans.subscriptionPayment.status.${row.submission.status}`,
                      )}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
            setRejectReason("")
          }
        }}
        open={Boolean(selected)}
      >
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.workspaceName}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Info
                  label={t("plans.admin.table.owner")}
                  value={`${selected.ownerName ?? "—"} · ${selected.ownerEmail ?? "—"}`}
                />
                <Info
                  label={t("plans.admin.table.plan")}
                  value={selected.planName}
                />
                <Info
                  label={t("plans.admin.table.price")}
                  value={selected.planPriceDisplay}
                />
                <Info
                  label={t("plans.admin.detail.paymentMethod")}
                  value={selected.submission.paymentMethod}
                />
                <Info
                  label={t("plans.admin.detail.reference")}
                  value={selected.submission.reference || "—"}
                />
                <Info
                  label={t("plans.admin.detail.submittedAt")}
                  value={new Date(selected.submission.createdAt).toLocaleString(
                    locale,
                  )}
                />
              </div>
              {selected.submission.receiptNote && (
                <Info
                  label={t("plans.admin.detail.note")}
                  value={selected.submission.receiptNote}
                />
              )}
              {selected.submission.rejectionReason && (
                <Info
                  label={t("plans.admin.detail.rejectionReason")}
                  value={selected.submission.rejectionReason}
                />
              )}
              {selected.receiptUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={selected.receiptUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t("plans.admin.detail.receipt")}
                  </a>
                </Button>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("plans.admin.detail.noReceipt")}
                </p>
              )}
              {selected.submission.status === "under_review" && (
                <div className="space-y-3 border-t pt-4">
                  <Button
                    className="w-full"
                    disabled={isConfirming}
                    onClick={() =>
                      confirmPayment({ submissionId: selected.submission.id })
                    }
                  >
                    {t("plans.admin.detail.confirm")}
                  </Button>
                  <Textarea
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder={t(
                      "plans.admin.detail.rejectReasonPlaceholder",
                    )}
                    value={rejectReason}
                  />
                  <Button
                    className="w-full"
                    disabled={isRejecting || rejectReason.trim().length < 3}
                    onClick={() =>
                      rejectPayment({
                        reason: rejectReason,
                        submissionId: selected.submission.id,
                      })
                    }
                    variant="destructive"
                  >
                    {t("plans.admin.detail.reject")}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
