import { z } from "zod"

export const platformSubscriptionStatuses = z.enum([
  "active",
  "past_due",
  "cancel_at_period_end",
  "cancelled",
  "expired",
])
export type PlatformSubscriptionStatus = z.infer<
  typeof platformSubscriptionStatuses
>

export const platformSubscriptionSources = z.enum([
  "free",
  "manual",
  "gateway",
  "admin",
])
export type PlatformSubscriptionSource = z.infer<
  typeof platformSubscriptionSources
>
