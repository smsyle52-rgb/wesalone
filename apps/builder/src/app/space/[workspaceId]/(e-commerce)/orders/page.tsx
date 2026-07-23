import { orderStatusTypes } from "@chatbotx.io/database/partials"
import { getIdFromParams } from "@chatbotx.io/utils"
import { OrdersTable } from "@/features/orders/orders-table"
import { listOrdersCursor } from "@/features/orders/queries"
import {
  buildOrdersNextCursor,
  listOrdersCursorSearchParams,
  orderCursorPositionSchema,
} from "@/features/orders/schema/query"
import { decodeCursor } from "@/lib/pagination"

export default async function OrdersPage(props: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  const search = listOrdersCursorSearchParams.parse(await props.searchParams)

  const statusResult = orderStatusTypes.safeParse(search.status)
  const status = statusResult.success ? statusResult.data : undefined
  const after = search.cursor
    ? decodeCursor(search.cursor, orderCursorPositionSchema)
    : null

  const { data, hasMore } = await listOrdersCursor({
    workspaceId,
    status,
    customerKeyword: search.customer ?? undefined,
    after: after ?? undefined,
  })

  return (
    <OrdersTable
      customerKeyword={search.customer}
      data={data}
      nextCursor={buildOrdersNextCursor(data, hasMore)}
      status={status}
      workspaceId={workspaceId}
    />
  )
}
