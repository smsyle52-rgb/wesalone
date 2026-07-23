import z from "zod"

export const platformSubscriptionPaymentStatusTypes = z.enum([
  "under_review",
  "confirmed",
  "rejected",
  "cancelled",
])
export type PlatformSubscriptionPaymentStatusType = z.infer<
  typeof platformSubscriptionPaymentStatusTypes
>

export const platformSubscriptionBillingCycles = z.enum(["monthly", "annual"])
export type PlatformSubscriptionBillingCycle = z.infer<
  typeof platformSubscriptionBillingCycles
>
