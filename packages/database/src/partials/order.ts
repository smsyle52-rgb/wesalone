import z from "zod"

export const orderStatusTypes = z.enum([
  "draft",
  // The merchant said yes. Deliberately not `pending_payment`: for a
  // wholesaler paid in cash on delivery nothing is pending payment, and the
  // agent drafts every order for exactly this confirmation.
  "confirmed",
  "pending_payment",
  "paid",
  "payment_review",
  "refunded",
  "cancelled",
  "expired",
])
export type OrderStatusType = z.infer<typeof orderStatusTypes>
