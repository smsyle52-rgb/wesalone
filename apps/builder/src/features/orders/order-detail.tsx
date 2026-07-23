"use client"

import type { ContactModel } from "@chatbotx.io/database/types"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@chatbotx.io/ui/components/ui/alert"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@chatbotx.io/ui/components/ui/avatar"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@chatbotx.io/ui/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chatbotx.io/ui/components/ui/table"
import { getPublicFileUrl } from "@chatbotx.io/utils"
import { AlertTriangle, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/features/orders/order-status-badge"
import type { getOrderDetail } from "@/features/orders/queries"
import { useTenantSettings } from "@/features/tenant"

type OrderDetailData = Awaited<ReturnType<typeof getOrderDetail>>
type OrderDetailItem = OrderDetailData["order"]["items"][number]

function formatReservationStatus(
  item: OrderDetailItem,
  t: ReturnType<typeof useTranslations>,
  dateFormatter: Intl.DateTimeFormat,
): string {
  if (item.reservationReleasedAt) {
    return t("orders.detail.reservationReleased")
  }
  if (item.reservedAt) {
    return t("orders.detail.reservedAt", {
      date: dateFormatter.format(new Date(item.reservedAt)),
    })
  }
  return "—"
}

type OrderDetailProps = {
  order: OrderDetailData["order"]
  contact: ContactModel | null
  workspaceId: string
}

export function OrderDetail({ order, contact, workspaceId }: OrderDetailProps) {
  const t = useTranslations()
  const locale = useLocale()
  const { storageUrl } = useTenantSettings()

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: order.currency,
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button asChild size="icon" variant="ghost">
          <Link href={`/space/${workspaceId}/orders`}>
            <ArrowLeft className="rtl:-scale-x-100" />
          </Link>
        </Button>
        <h1 className="font-semibold text-lg">
          {t("orders.detail.title", { id: order.id.slice(-8) })}
        </h1>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.status === "payment_review" && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>{t("orders.detail.paymentReviewTitle")}</AlertTitle>
          <AlertDescription>
            {t("orders.detail.paymentReviewDescription")}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("orders.detail.itemsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("orders.detail.columns.product")}</TableHead>
                    <TableHead>{t("orders.detail.columns.quantity")}</TableHead>
                    <TableHead>
                      {t("orders.detail.columns.unitPrice")}
                    </TableHead>
                    <TableHead>
                      {t("orders.detail.columns.lineTotal")}
                    </TableHead>
                    <TableHead>
                      {t("orders.detail.columns.reservation")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.product.name}</div>
                        {item.productVariant && (
                          <div className="text-muted-foreground text-xs">
                            {Object.values(
                              item.productVariant.combination,
                            ).join(" / ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>
                        {currencyFormatter.format(item.unitPrice)}
                      </TableCell>
                      <TableCell>
                        {currencyFormatter.format(item.lineTotal)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatReservationStatus(item, t, dateFormatter)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="ms-auto mt-4 max-w-56 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("orders.detail.subtotal")}
                  </span>
                  <span>{currencyFormatter.format(order.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("orders.detail.tax")}
                  </span>
                  <span>{currencyFormatter.format(order.taxTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("orders.detail.discount")}
                  </span>
                  <span>{currencyFormatter.format(order.discountTotal)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>{t("orders.detail.total")}</span>
                  <span>{currencyFormatter.format(order.total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("orders.detail.paymentHistoryTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {order.payments.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("orders.detail.noPayments")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("orders.detail.columns.provider")}
                      </TableHead>
                      <TableHead>{t("orders.columns.paymentStatus")}</TableHead>
                      <TableHead>{t("orders.columns.amount")}</TableHead>
                      <TableHead>
                        {t("orders.detail.columns.confirmedAt")}
                      </TableHead>
                      <TableHead>
                        {t("orders.detail.columns.failureReason")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="capitalize">
                          {payment.provider}
                        </TableCell>
                        <TableCell>
                          <PaymentStatusBadge status={payment.status} />
                        </TableCell>
                        <TableCell>
                          {new Intl.NumberFormat(locale, {
                            style: "currency",
                            currency: payment.currency,
                          }).format(payment.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {payment.confirmedAt
                            ? dateFormatter.format(
                                new Date(payment.confirmedAt),
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {payment.failureReason ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("orders.detail.customerTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contact ? (
                <div className="flex items-center gap-2">
                  <Avatar>
                    <AvatarImage
                      src={
                        contact.avatar
                          ? getPublicFileUrl(contact.avatar, storageUrl)
                          : undefined
                      }
                    />
                    <AvatarFallback>
                      {contact.fullName?.charAt(0) ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span>{contact.fullName ?? "—"}</span>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("orders.noCustomer")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("orders.detail.datesTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("orders.columns.createdAt")}
                </span>
                <span>{dateFormatter.format(new Date(order.createdAt))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("orders.detail.expiresAt")}
                </span>
                <span>
                  {order.expiresAt
                    ? dateFormatter.format(new Date(order.expiresAt))
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
