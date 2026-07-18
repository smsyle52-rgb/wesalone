import z from "zod"

export const orderStatusTypes = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "payment_review",
  "refunded",
  "cancelled",
  "expired",
])
export type OrderStatusType = z.infer<typeof orderStatusTypes>
