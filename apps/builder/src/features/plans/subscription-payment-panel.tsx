"use client"

import type { WesalOnePlan } from "@chatbotx.io/business"
import type {
  PlatformSubscriptionModel,
  PlatformSubscriptionPaymentModel,
} from "@chatbotx.io/database/types"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Input } from "@chatbotx.io/ui/components/ui/input"
import { Label } from "@chatbotx.io/ui/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chatbotx.io/ui/components/ui/select"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { cancelSubscriptionPaymentAction } from "./actions/cancel-subscription-payment.action"
import { resumeSubscriptionAction } from "./actions/resume-subscription.action"
import { scheduleSubscriptionCancellationAction } from "./actions/schedule-subscription-cancellation.action"
import { submitSubscriptionPaymentAction } from "./actions/submit-subscription-payment.action"
import {
  ReceiptUploadError,
  useReceiptUpload,
} from "./hooks/use-receipt-upload"

export type SubscriptionPaymentSubmission = PlatformSubscriptionPaymentModel & {
  receiptUrl: string | null
}

type Props = {
  billingCycle: "monthly" | "annual"
  workspaceId: string
  plans: readonly WesalOnePlan[]
  submissions: SubscriptionPaymentSubmission[]
  subscription: PlatformSubscriptionModel | null
  openPlanSlug: string | null
  onOpenChange: (slug: string | null) => void
}

// The canonical manual methods (packages/database/src/partials/manual-payment.ts),
// same list the point-purchase panel offers. This previously listed
// wallet_transfer/other — values no enum accepts — while omitting kuraimi and
// jawali, so a merchant paying through either could not say so when
// subscribing, only when buying points.
const PAYMENT_METHODS = ["kuraimi", "jawali", "bank_transfer", "cash"] as const

export function SubscriptionPaymentPanel({
  billingCycle,
  workspaceId,
  plans,
  submissions,
  subscription,
  openPlanSlug,
  onOpenChange,
}: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const { upload } = useReceiptUpload(workspaceId)
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { execute, isPending } = useAction(
    submitSubscriptionPaymentAction.bind(null, workspaceId),
    {
      onSuccess: () => {
        toast.success(t("plans.subscriptionPayment.toast.submitted"))
        resetForm()
        onOpenChange(null)
      },
      onError: ({ error }) => {
        toast.error(
          error.serverError ?? t("plans.subscriptionPayment.toast.submitError"),
        )
      },
    },
  )

  const { execute: cancel, isPending: isCancelling } = useAction(
    cancelSubscriptionPaymentAction.bind(null, workspaceId),
    {
      onSuccess: () =>
        toast.success(t("plans.subscriptionPayment.toast.cancelled")),
      onError: ({ error }) =>
        toast.error(
          error.serverError ?? t("plans.subscriptionPayment.toast.cancelError"),
        ),
    },
  )

  const { execute: scheduleCancellation, isPending: isSchedulingCancellation } =
    useAction(scheduleSubscriptionCancellationAction.bind(null, workspaceId), {
      onSuccess: () => {
        toast.success(
          t("plans.subscriptionPayment.toast.cancellationScheduled"),
        )
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(
          error.serverError ??
            t("plans.subscriptionPayment.toast.cancellationScheduleError"),
        ),
    })

  const { execute: resumeSubscription, isPending: isResuming } = useAction(
    resumeSubscriptionAction.bind(null, workspaceId),
    {
      onSuccess: () => {
        toast.success(t("plans.subscriptionPayment.toast.resumed"))
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(
          error.serverError ?? t("plans.subscriptionPayment.toast.resumeError"),
        ),
    },
  )

  function resetForm() {
    setPaymentMethod("bank_transfer")
    setReference("")
    setNote("")
    setFile(null)
    setFileError(null)
  }

  const plan = plans.find((p) => p.slug === openPlanSlug)
  const activeReview = submissions.find((s) => s.status === "under_review")
  const history = submissions.filter((s) => s.status !== "under_review")

  const statusLabel = (status: string) =>
    t(`plans.subscriptionPayment.status.${status}`)
  const planName = (slug: string) => {
    const p = plans.find((candidate) => candidate.slug === slug)
    if (!p) {
      return slug
    }
    return locale === "ar" ? p.nameAr : p.nameEn
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!(plan && file)) {
      return
    }
    setFileError(null)
    setUploading(true)
    try {
      const { fileId } = await upload(file)
      execute({
        billingCycle,
        paymentMethod: paymentMethod as (typeof PAYMENT_METHODS)[number],
        planSlug: plan.slug as "starter" | "growth" | "professional",
        receiptFileId: fileId,
        receiptNote: note || undefined,
        reference: reference || undefined,
      })
    } catch (err) {
      const code = err instanceof ReceiptUploadError ? err.code : "uploadFailed"
      setFileError(t(`plans.subscriptionPayment.receiptErrors.${code}`))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {subscription && (
        <div className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">
                {t("plans.subscriptionPayment.currentSubscription")}
              </p>
              <p className="text-sm">
                {planName(subscription.planSlug)}
                {" · "}
                {t(
                  `plans.subscriptionPayment.subscriptionStatus.${subscription.status}`,
                )}
              </p>
              <p className="text-muted-foreground text-xs">
                {t(
                  subscription.status === "cancel_at_period_end"
                    ? "plans.subscriptionPayment.endsOn"
                    : "plans.subscriptionPayment.renewsOn",
                  {
                    date: new Date(subscription.periodEnd).toLocaleDateString(
                      locale,
                    ),
                  },
                )}
              </p>
            </div>
            {subscription.source !== "free" &&
              subscription.status === "cancel_at_period_end" && (
                <Button
                  disabled={isResuming}
                  onClick={() => resumeSubscription()}
                  size="sm"
                  variant="outline"
                >
                  {t("plans.subscriptionPayment.resumeSubscription")}
                </Button>
              )}
            {subscription.source !== "free" &&
              subscription.status === "active" && (
                <Button
                  disabled={isSchedulingCancellation}
                  onClick={() => scheduleCancellation()}
                  size="sm"
                  variant="outline"
                >
                  {t("plans.subscriptionPayment.cancelSubscription")}
                </Button>
              )}
          </div>
        </div>
      )}
      {activeReview && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">
                {t("plans.subscriptionPayment.underReview")}
              </p>
              <p className="text-sm">
                {planName(activeReview.planSlug)}
                {" · "}
                {new Date(activeReview.createdAt).toLocaleDateString(locale)}
              </p>
            </div>
            <div className="flex gap-2">
              {activeReview.receiptUrl && (
                <Button
                  render={
                    <a
                      href={activeReview.receiptUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {t("plans.subscriptionPayment.viewReceipt")}
                    </a>
                  }
                  size="sm"
                  variant="outline"
                />
              )}
              <Button
                disabled={isCancelling}
                onClick={() => cancel({ submissionId: activeReview.id })}
                size="sm"
                variant="outline"
              >
                {t("plans.subscriptionPayment.cancelRequest")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-xl border p-4">
          <p className="mb-3 font-bold text-sm">
            {t("plans.subscriptionPayment.history")}
          </p>
          <div className="space-y-2">
            {history.map((submission) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
                key={submission.id}
              >
                <div>
                  <p className="font-medium">{planName(submission.planSlug)}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(submission.createdAt).toLocaleDateString(locale)}
                    {submission.rejectionReason && (
                      <> · {submission.rejectionReason}</>
                    )}
                  </p>
                </div>
                <Badge variant="outline">
                  {statusLabel(submission.status)}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog
        onOpenChange={(open) => onOpenChange(open ? openPlanSlug : null)}
        open={Boolean(plan)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("plans.subscriptionPayment.dialogTitle", {
                plan: plan ? planName(plan.slug) : "",
              })}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              {t(`plans.${billingCycle === "annual" ? "yearly" : "monthly"}`)}
              {plan && (
                <span className="ms-2 font-semibold">
                  $
                  {billingCycle === "annual"
                    ? plan.priceYearlyUsd
                    : plan.priceMonthlyUsd}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("plans.subscriptionPayment.paymentMethod")}</Label>
              <Select
                onValueChange={(value) => setPaymentMethod(value as string)}
                value={paymentMethod}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`plans.subscriptionPayment.methods.${method}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-payment-reference">
                {t("plans.subscriptionPayment.reference")}
              </Label>
              <Input
                id="subscription-payment-reference"
                onChange={(event) => setReference(event.target.value)}
                value={reference}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-payment-receipt">
                {t("plans.subscriptionPayment.receipt")}
              </Label>
              <Input
                accept="image/jpeg,image/png,image/webp"
                id="subscription-payment-receipt"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setFileError(null)
                }}
                type="file"
              />
              {fileError && (
                <p className="text-destructive text-sm">{fileError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-payment-note">
                {t("plans.subscriptionPayment.note")}
              </Label>
              <Textarea
                id="subscription-payment-note"
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </div>
            <DialogFooter>
              <Button disabled={!file || uploading || isPending} type="submit">
                {uploading || isPending
                  ? t("plans.subscriptionPayment.sending")
                  : t("plans.subscriptionPayment.send")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
