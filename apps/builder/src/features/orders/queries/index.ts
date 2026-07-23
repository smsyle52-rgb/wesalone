import { contactService, orderService } from "@chatbotx.io/business"
import type {
  OrderStatusType,
  PaymentStatusType,
} from "@chatbotx.io/database/partials"
import type {
  OrderItemModel,
  OrderModel,
  PaymentModel,
  ProductModel,
  ProductVariantModel,
} from "@chatbotx.io/database/types"
import type { OrderListItemResource } from "@/features/orders/schema/resource"

// pgEnum columns come back as plain `string` on OrderModel/PaymentModel (the
// enum's literal union is erased when the schema declares the pgEnum with a
// widened `[string, ...string[]]` tuple) — the same reason the oRPC resource
// schemas re-assert `status` with the zod enum. These RSC queries bypass
// oRPC's output validation entirely (direct service calls, like the sibling
// products RSC query), so they re-narrow it themselves instead.
type OrderDetailResult = Omit<OrderModel, "status"> & {
  status: OrderStatusType
  items: (OrderItemModel & {
    product: ProductModel
    productVariant: ProductVariantModel | null
  })[]
  payments: (Omit<PaymentModel, "status"> & { status: PaymentStatusType })[]
}

// Both the (e-commerce)/orders and the plain orders/[orderId] layouts gate
// this whole route tree on the "ecommerce" workspace permission
// (resolveGuardedWorkspaceId), so these queries, like the sibling products
// RSC query, do not re-check it here.
export const listOrdersCursor = async (params: {
  workspaceId: string
  status?: OrderStatusType
  customerKeyword?: string
  after?: { createdAt: Date; id: string }
  perPage?: number | null
}) => {
  const result = await orderService.listCursor(params)
  return { ...result, data: result.data as OrderListItemResource[] }
}

export const getOrderDetail = async (params: {
  workspaceId: string
  orderId: string
}) => {
  const { workspaceId, orderId } = params
  const order = await orderService.getById({ workspaceId, orderId })
  const contact = order.contactId
    ? ((await contactService.findById({
        workspaceId,
        id: order.contactId,
      })) ?? null)
    : null
  return { order: order as OrderDetailResult, contact }
}
