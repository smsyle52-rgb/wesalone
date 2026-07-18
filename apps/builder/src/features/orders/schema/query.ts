import { orderStatusTypes } from "@chatbotx.io/database/partials"
import { createSearchParamsCache, parseAsString } from "nuqs/server"
import { z } from "zod"
import { basePaginationRequest, encodeCursor } from "@/lib/pagination"
import { orderListItemResource, orderResource } from "./resource"

export const listOrdersRequest = basePaginationRequest.extend({
  status: orderStatusTypes.optional(),
  contactId: z.string().optional(),
})
export type ListOrdersRequest = z.infer<typeof listOrdersRequest>

export const listOrdersResponse = z.object({
  data: z.array(orderResource),
  pageCount: z.number(),
})
export type ListOrdersResponse = z.infer<typeof listOrdersResponse>

// Cursor-paginated variant for the admin Orders table (see orderService.listCursor) —
// kept separate from listOrdersRequest/listOrdersResponse above, which stay
// page-based for their existing callers.
export const listOrdersCursorRequest = z.object({
  cursor: z.string().optional(),
  perPage: z.coerce.number().int().min(1).nullish(),
  status: orderStatusTypes.optional(),
  customerKeyword: z.string().trim().min(1).optional(),
})
export type ListOrdersCursorRequest = z.infer<typeof listOrdersCursorRequest>

export const listOrdersCursorResponse = z.object({
  data: z.array(orderListItemResource),
  nextCursor: z.string().nullable(),
})
export type ListOrdersCursorResponse = z.infer<typeof listOrdersCursorResponse>

export const orderCursorPositionSchema = z.object({
  createdAt: z.coerce.date(),
  id: z.string(),
})
export type OrderCursorPosition = z.infer<typeof orderCursorPositionSchema>

export const listOrdersCursorSearchParams = createSearchParamsCache({
  cursor: parseAsString,
  status: parseAsString,
  customer: parseAsString,
})

// Shared by the oRPC handler and the SSR page query so both encode the same
// opaque nextCursor shape from a listCursor() result.
export function buildOrdersNextCursor(
  data: { createdAt: Date; id: string }[],
  hasMore: boolean,
): string | null {
  const last = data.at(-1)
  return hasMore && last
    ? encodeCursor({ createdAt: last.createdAt, id: last.id })
    : null
}
