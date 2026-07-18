import z from "zod"

export const paymentStatusTypes = z.enum([
  "pending",
  "paid",
  "failed",
  "refunded",
])
export type PaymentStatusType = z.infer<typeof paymentStatusTypes>
