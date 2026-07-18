import {
  orderStatusTypes,
  paymentStatusTypes,
} from "@chatbotx.io/database/partials"
import {
  createSelectSchema,
  orderItemModel,
  orderModel,
  paymentModel,
} from "@chatbotx.io/database/schema"
import z from "zod"

export const orderItemResource = createSelectSchema(orderItemModel, {
  id: z.string(),
  workspaceId: z.string(),
  orderId: z.string(),
  productId: z.string(),
  productVariantId: z.string().nullable(),
  locationId: z.string().nullable(),
})
export type OrderItemResource = z.infer<typeof orderItemResource>

export const paymentResource = createSelectSchema(paymentModel, {
  id: z.string(),
  workspaceId: z.string(),
  orderId: z.string(),
  status: paymentStatusTypes,
})
export type PaymentResource = z.infer<typeof paymentResource>

export const orderResource = createSelectSchema(orderModel, {
  id: z.string(),
  workspaceId: z.string(),
  contactId: z.string().nullable(),
  status: orderStatusTypes,
}).extend({
  items: z.array(orderItemResource).optional(),
  payments: z.array(paymentResource).optional(),
})
export type OrderResource = z.infer<typeof orderResource>

export const orderListContactResource = z.object({
  id: z.string(),
  fullName: z.string().nullable(),
  avatar: z.string().nullable(),
})

export const orderListItemResource = createSelectSchema(orderModel, {
  id: z.string(),
  workspaceId: z.string(),
  contactId: z.string().nullable(),
  status: orderStatusTypes,
}).extend({
  contact: orderListContactResource.nullable(),
  // Latest payment attempt only (0 or 1 row) — see orderService.listCursor.
  payments: z.array(paymentResource).max(1),
})
export type OrderListItemResource = z.infer<typeof orderListItemResource>
