"use client"

import type { PointPurchaseOrderModel } from "@chatbotx.io/database/types"
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
import { confirmPointPurchaseOrderAction } from "./actions/confirm-point-purchase-order.action"
import { rejectPointPurchaseOrderAction } from "./actions/reject-point-purchase-order.action"

// This file must never import anything at runtime from @chatbotx.io/business
// — see admin-subscription-payments-view.tsx's own note on why. All order
// data is resolved server-side (page.tsx) and handed down as plain values.
export type AdminOrderRow = {
  order: PointPurchaseOrderModel
  buyerName: string | null
  buyerEmail: string | null
  productNameEn: string
  receiptUrl: string | null
}

type Props = {
  status: string
  orders: AdminOrderRow[]
}

const STATUS_OPTIONS = [
  "under_review",
  "approved",
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

export function AdminPointPurchaseOrdersView({ status, orders }: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [selected, setSelected] = useState<AdminOrderRow | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const { execute: confirmOrder, isPending: isConfirming } = useAction(
    confirmPointPurchaseOrderAction,
    {
      onSuccess: () => {
        toast.success(t("plans.pointPurchaseAdmin.toast.confirmed"))
        setSelected(null)
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(
          error.serverError ?? t("plans.pointPurchaseAdmin.toast.confirmError"),
        ),
    },
  )

  const { execute: rejectOrder, isPending: isRejecting } = useAction(
    rejectPointPurchaseOrderAction,
    {
      onSuccess: () => {
        toast.success(t("plans.pointPurchaseAdmin.toast.rejected"))
        setSelected(null)
        setRejectReason("")
        router.refresh()
      },
      onError: ({ error }) =>
        toast.error(
          error.serverError ?? t("plans.pointPurchaseAdmin.toast.rejectError"),
        ),
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
            router.push(`/admin/point-purchase-orders?status=${value}`)
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
                  : t(`plans.pointPurchase.status.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          {t("plans.admin.empty")}
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("plans.pointPurchaseAdmin.table.buyer")}
                </TableHead>
                <TableHead>
                  {t("plans.pointPurchaseAdmin.table.bundle")}
                </TableHead>
                <TableHead>
                  {t("plans.pointPurchaseAdmin.table.points")}
                </TableHead>
                <TableHead>{t("plans.admin.table.price")}</TableHead>
                <TableHead>{t("plans.admin.table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row) => (
                <TableRow
                  className="cursor-pointer"
                  key={row.order.id}
                  onClick={() => setSelected(row)}
                >
                  <TableCell>
                    <div className="font-medium">{row.buyerName ?? "—"}</div>
                    <div className="text-muted-foreground text-xs" dir="ltr">
                      {row.buyerEmail ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>{row.productNameEn}</TableCell>
                  <TableCell>
                    {row.order.pointsSnapshot.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    ${(row.order.priceCentsSnapshot / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`plans.pointPurchase.status.${row.order.status}`)}
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
                <DialogTitle>{selected.buyerName ?? "—"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Info
                  label={t("plans.pointPurchaseAdmin.table.buyer")}
                  value={`${selected.buyerName ?? "—"} · ${selected.buyerEmail ?? "—"}`}
                />
                <Info
                  label={t("plans.pointPurchaseAdmin.table.bundle")}
                  value={selected.productNameEn}
                />
                <Info
                  label={t("plans.pointPurchaseAdmin.table.points")}
                  value={selected.order.pointsSnapshot.toLocaleString()}
                />
                <Info
                  label={t("plans.admin.table.price")}
                  value={`$${(selected.order.priceCentsSnapshot / 100).toFixed(2)}`}
                />
                <Info
                  label={t("plans.admin.detail.paymentMethod")}
                  value={
                    selected.order.paymentMethod
                      ? t(
                          `plans.pointPurchase.methods.${selected.order.paymentMethod}`,
                        )
                      : "—"
                  }
                />
                <Info
                  label={t("plans.admin.detail.reference")}
                  value={selected.order.reference || "—"}
                />
                <Info
                  label={t("plans.admin.detail.submittedAt")}
                  value={new Date(selected.order.createdAt).toLocaleString(
                    locale,
                  )}
                />
              </div>
              {selected.order.receiptNote && (
                <Info
                  label={t("plans.admin.detail.note")}
                  value={selected.order.receiptNote}
                />
              )}
              {selected.order.rejectionReason && (
                <Info
                  label={t("plans.admin.detail.rejectionReason")}
                  value={selected.order.rejectionReason}
                />
              )}
              {selected.receiptUrl ? (
                <Button
                  render={
                    <a
                      href={selected.receiptUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {t("plans.admin.detail.receipt")}
                    </a>
                  }
                  size="sm"
                  variant="outline"
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("plans.admin.detail.noReceipt")}
                </p>
              )}
              {selected.order.status === "under_review" && (
                <div className="space-y-3 border-t pt-4">
                  <Button
                    className="w-full"
                    disabled={isConfirming}
                    onClick={() => confirmOrder({ orderId: selected.order.id })}
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
                      rejectOrder({
                        orderId: selected.order.id,
                        reason: rejectReason,
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
