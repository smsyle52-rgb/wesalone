"use client"

import type { PointPurchaseOrderModel } from "@chatbotx.io/database/types"
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
import { useLocale, useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { cancelPointPurchaseOrderAction } from "./actions/cancel-point-purchase-order.action"
import { submitPointPurchaseOrderAction } from "./actions/submit-point-purchase-order.action"
import {
  ReceiptUploadError,
  useReceiptUpload,
} from "./hooks/use-receipt-upload"

export type PointTopupProductOption = {
  slug: string
  nameAr: string
  nameEn: string
  points: number
  priceCents: number
  currency: string
}

export type PointPurchaseOrderRow = PointPurchaseOrderModel & {
  receiptUrl: string | null
}

type Props = {
  workspaceId: string
  products: PointTopupProductOption[]
  orders: PointPurchaseOrderRow[]
  openProductSlug: string | null
  onOpenChange: (slug: string | null) => void
}

const PAYMENT_METHODS = ["kuraimi", "jawali", "bank_transfer", "cash"] as const

export function PointPurchasePanel({
  workspaceId,
  products,
  orders,
  openProductSlug,
  onOpenChange,
}: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const { upload } = useReceiptUpload(workspaceId)
  const [paymentMethod, setPaymentMethod] = useState<string>("kuraimi")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { execute, isPending } = useAction(
    submitPointPurchaseOrderAction.bind(null, workspaceId),
    {
      onSuccess: () => {
        toast.success(t("plans.pointPurchase.toast.submitted"))
        resetForm()
        onOpenChange(null)
      },
      onError: ({ error }) => {
        toast.error(
          error.serverError ?? t("plans.pointPurchase.toast.submitError"),
        )
      },
    },
  )

  const { execute: cancel, isPending: isCancelling } = useAction(
    cancelPointPurchaseOrderAction.bind(null, workspaceId),
    {
      onSuccess: () => toast.success(t("plans.pointPurchase.toast.cancelled")),
      onError: ({ error }) =>
        toast.error(
          error.serverError ?? t("plans.pointPurchase.toast.cancelError"),
        ),
    },
  )

  function resetForm() {
    setPaymentMethod("kuraimi")
    setReference("")
    setNote("")
    setFile(null)
    setFileError(null)
  }

  const product = products.find((p) => p.slug === openProductSlug)
  const activeReview = orders.find((o) => o.status === "under_review")
  const history = orders.filter((o) => o.status !== "under_review")

  const productName = (slug: string) => {
    const p = products.find((candidate) => candidate.slug === slug)
    if (!p) {
      return slug
    }
    return locale === "ar" ? p.nameAr : p.nameEn
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!(product && file)) {
      return
    }
    setFileError(null)
    setUploading(true)
    try {
      const { fileId } = await upload(file)
      execute({
        paymentMethod: paymentMethod as (typeof PAYMENT_METHODS)[number],
        receiptFileId: fileId,
        receiptNote: note || undefined,
        reference: reference || undefined,
        topupProductSlug: product.slug,
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
      {activeReview && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">
                {t("plans.pointPurchase.underReview")}
              </p>
              <p className="text-sm">
                {productName(activeReview.productSlugSnapshot)}
                {" · "}
                {new Date(activeReview.createdAt).toLocaleDateString(locale)}
              </p>
            </div>
            <div className="flex gap-2">
              {activeReview.receiptUrl && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={activeReview.receiptUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t("plans.subscriptionPayment.viewReceipt")}
                  </a>
                </Button>
              )}
              <Button
                disabled={isCancelling}
                onClick={() => cancel({ orderId: activeReview.id })}
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
            {t("plans.pointPurchase.history")}
          </p>
          <div className="space-y-2">
            {history.map((order) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
                key={order.id}
              >
                <div>
                  <p className="font-medium">
                    {productName(order.productSlugSnapshot)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(order.createdAt).toLocaleDateString(locale)}
                    {order.rejectionReason && <> · {order.rejectionReason}</>}
                  </p>
                </div>
                <Badge variant="outline">
                  {t(`plans.pointPurchase.status.${order.status}`)}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog
        onOpenChange={(open) => onOpenChange(open ? openProductSlug : null)}
        open={Boolean(product)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("plans.pointPurchase.dialogTitle", {
                product: product ? productName(product.slug) : "",
              })}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label>{t("plans.subscriptionPayment.paymentMethod")}</Label>
              <Select onValueChange={setPaymentMethod} value={paymentMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`plans.pointPurchase.methods.${method}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="point-purchase-reference">
                {t("plans.subscriptionPayment.reference")}
              </Label>
              <Input
                id="point-purchase-reference"
                onChange={(event) => setReference(event.target.value)}
                value={reference}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="point-purchase-receipt">
                {t("plans.subscriptionPayment.receipt")}
              </Label>
              <Input
                accept="image/jpeg,image/png,image/webp"
                id="point-purchase-receipt"
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
              <Label htmlFor="point-purchase-note">
                {t("plans.subscriptionPayment.note")}
              </Label>
              <Textarea
                id="point-purchase-note"
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
