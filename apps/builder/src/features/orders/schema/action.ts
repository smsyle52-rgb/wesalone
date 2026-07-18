import { z } from "zod"

export const createDraftOrderRequest = z.object({
  contactId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(255).optional(),
})
export type CreateDraftOrderRequest = z.infer<typeof createDraftOrderRequest>

export const addOrderItemRequest = z.object({
  productId: z.string().min(1),
  productVariantId: z.string().min(1).optional(),
  quantity: z.coerce.number().int().min(1),
})
export type AddOrderItemRequest = z.infer<typeof addOrderItemRequest>

export const checkoutOrderRequest = z.object({
  provider: z.string().min(1).default("mock"),
  idempotencyKey: z.string().min(1).max(255),
})
export type CheckoutOrderRequest = z.infer<typeof checkoutOrderRequest>

export const checkoutOrderResponse = z.object({
  orderId: z.string(),
  status: z.string(),
  checkoutReference: z.string(),
  redirectUrl: z.string().optional(),
})
export type CheckoutOrderResponse = z.infer<typeof checkoutOrderResponse>
