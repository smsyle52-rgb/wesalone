"use client"

import type {
  OrderStatusType,
  PaymentStatusType,
} from "@chatbotx.io/database/partials"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { AlertTriangle } from "lucide-react"
import { useTranslations } from "next-intl"
import { type ReactNode, useMemo } from "react"

function createOrderStatusBadgeMap(
  t: ReturnType<typeof useTranslations>,
): Record<OrderStatusType, ReactNode> {
  return {
    draft: <Badge variant="outline">{t("orders.status.draft")}</Badge>,
    pending_payment: (
      <Badge variant="secondary">{t("orders.status.pending_payment")}</Badge>
    ),
    paid: (
      <Badge className="bg-green-500" variant="default">
        {t("orders.status.paid")}
      </Badge>
    ),
    payment_review: (
      <Badge className="gap-1 bg-amber-500" variant="default">
        <AlertTriangle className="size-3" />
        {t("orders.status.payment_review")}
      </Badge>
    ),
    refunded: <Badge variant="secondary">{t("orders.status.refunded")}</Badge>,
    cancelled: (
      <Badge variant="destructive">{t("orders.status.cancelled")}</Badge>
    ),
    expired: <Badge variant="destructive">{t("orders.status.expired")}</Badge>,
  }
}

export function OrderStatusBadge({ status }: { status: OrderStatusType }) {
  const t = useTranslations()
  const map = useMemo(() => createOrderStatusBadgeMap(t), [t])
  return map[status]
}

function createPaymentStatusBadgeMap(
  t: ReturnType<typeof useTranslations>,
): Record<PaymentStatusType, ReactNode> {
  return {
    pending: (
      <Badge variant="outline">{t("orders.paymentStatus.pending")}</Badge>
    ),
    paid: (
      <Badge className="bg-green-500" variant="default">
        {t("orders.paymentStatus.paid")}
      </Badge>
    ),
    failed: (
      <Badge variant="destructive">{t("orders.paymentStatus.failed")}</Badge>
    ),
    refunded: (
      <Badge variant="secondary">{t("orders.paymentStatus.refunded")}</Badge>
    ),
  }
}

export function PaymentStatusBadge({ status }: { status: PaymentStatusType }) {
  const t = useTranslations()
  const map = useMemo(() => createPaymentStatusBadgeMap(t), [t])
  return map[status]
}
