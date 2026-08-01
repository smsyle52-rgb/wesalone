"use client"

import type { OrderStatusType } from "@chatbotx.io/database/partials"
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
import { Input } from "@chatbotx.io/ui/components/ui/input"
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
import { getPublicFileUrl } from "@chatbotx.io/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useQueryStates } from "nuqs"
import { parseAsString } from "nuqs/server"
import { useEffect, useMemo, useState } from "react"
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "@/features/orders/order-status-badge"
import type { OrderListItemResource } from "@/features/orders/schema/resource"
import { useTenantSettings } from "@/features/tenant"

const ORDER_STATUS_VALUES: OrderStatusType[] = [
  "draft",
  "pending_payment",
  "paid",
  "payment_review",
  "refunded",
  "cancelled",
  "expired",
]

type OrdersTableProps = {
  data: OrderListItemResource[]
  nextCursor: string | null
  status?: OrderStatusType
  customerKeyword?: string | null
  workspaceId: string
}

export function OrdersTable({
  data,
  nextCursor,
  status,
  customerKeyword,
  workspaceId,
}: OrdersTableProps) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const { storageUrl } = useTenantSettings()

  const [{ cursor }, setQuery] = useQueryStates(
    {
      cursor: parseAsString,
      status: parseAsString,
      customer: parseAsString,
    },
    { shallow: false },
  )

  // Stack of cursors already visited, so "previous" can step back without a
  // second round-trip endpoint — cleared whenever a filter changes.
  const [history, setHistory] = useState<string[]>([])
  const [customerInput, setCustomerInput] = useState(customerKeyword ?? "")

  useEffect(() => {
    setCustomerInput(customerKeyword ?? "")
  }, [customerKeyword])

  useEffect(() => {
    const trimmed = customerInput.trim()
    const current = customerKeyword ?? ""
    if (trimmed === current) {
      return
    }
    const timeout = setTimeout(() => {
      setHistory([])
      setQuery({ customer: trimmed || null, cursor: null })
    }, 400)
    return () => clearTimeout(timeout)
  }, [customerInput, customerKeyword, setQuery])

  const currencyFormatters = useMemo(
    () => new Map<string, Intl.NumberFormat>(),
    [],
  )
  const formatAmount = (amount: number, currency: string) => {
    let formatter = currencyFormatters.get(currency)
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: "currency", currency })
      currencyFormatters.set(currency, formatter)
    }
    return formatter.format(amount)
  }

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  )

  const handleStatusChange = (value: string) => {
    setHistory([])
    setQuery({ status: value === "all" ? null : value, cursor: null })
  }

  const handleNext = () => {
    if (!nextCursor) {
      return
    }
    setHistory((prev) => [...prev, cursor ?? ""])
    setQuery({ cursor: nextCursor })
  }

  const handlePrev = () => {
    const prevHistory = [...history]
    const previousCursor = prevHistory.pop() ?? ""
    setHistory(prevHistory)
    setQuery({ cursor: previousCursor || null })
  }

  const canGoPrev = history.length > 0 || Boolean(cursor)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold text-xl">{t("orders.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            className="sm:max-w-64"
            onChange={(event) => setCustomerInput(event.target.value)}
            placeholder={t("orders.filters.customerPlaceholder")}
            value={customerInput}
          />
          <Select
            onValueChange={(value) => handleStatusChange(value as string)}
            value={status ?? "all"}
          >
            <SelectTrigger className="sm:w-52">
              <SelectValue
                placeholder={t("orders.filters.statusPlaceholder")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("orders.filters.allStatuses")}
              </SelectItem>
              {ORDER_STATUS_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`orders.status.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("orders.columns.orderNumber")}</TableHead>
                <TableHead>{t("orders.columns.customer")}</TableHead>
                <TableHead>{t("orders.columns.status")}</TableHead>
                <TableHead>{t("orders.columns.amount")}</TableHead>
                <TableHead>{t("orders.columns.paymentStatus")}</TableHead>
                <TableHead>{t("orders.columns.createdAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-muted-foreground"
                    colSpan={6}
                  >
                    {t("orders.emptyState")}
                  </TableCell>
                </TableRow>
              )}
              {data.map((order) => (
                <TableRow
                  className="cursor-pointer"
                  key={order.id}
                  onClick={() =>
                    router.push(`/space/${workspaceId}/orders/${order.id}`)
                  }
                >
                  <TableCell className="font-medium">
                    #{order.id.slice(-8)}
                  </TableCell>
                  <TableCell>
                    {order.contact ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarImage
                            src={
                              order.contact.avatar
                                ? getPublicFileUrl(
                                    order.contact.avatar,
                                    storageUrl,
                                  )
                                : undefined
                            }
                          />
                          <AvatarFallback>
                            {order.contact.fullName?.charAt(0) ?? "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate">
                          {order.contact.fullName ?? "—"}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("orders.noCustomer")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    {formatAmount(order.total, order.currency)}
                  </TableCell>
                  <TableCell>
                    {order.payments[0] ? (
                      <PaymentStatusBadge status={order.payments[0].status} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dateFormatter.format(new Date(order.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            aria-label={t("orders.pagination.previous")}
            disabled={!canGoPrev}
            onClick={handlePrev}
            size="icon"
            variant="outline"
          >
            <ChevronLeft className="rtl:-scale-x-100" />
          </Button>
          <Button
            aria-label={t("orders.pagination.next")}
            disabled={!nextCursor}
            onClick={handleNext}
            size="icon"
            variant="outline"
          >
            <ChevronRight className="rtl:-scale-x-100" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
