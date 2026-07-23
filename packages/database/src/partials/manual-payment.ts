import z from "zod"

// The manual (no payment-gateway) methods a Yemen-market merchant actually
// pays with — ported from Wesal One's original manual billing flow. Shared
// between platform-subscription payments and point purchase orders, which
// both collect a payment claim + proof this same way.
export const manualPaymentMethods = z.enum([
  "kuraimi",
  "jawali",
  "bank_transfer",
  "cash",
])
export type ManualPaymentMethod = z.infer<typeof manualPaymentMethods>
