export type CreateCheckoutSessionInput = {
  orderId: string
  workspaceId: string
  amount: number
  currency: string
  idempotencyKey: string
}

export type CheckoutSession = {
  provider: string
  checkoutReference: string
  redirectUrl?: string
}

export type NormalizedPaymentEvent = {
  providerEventId: string
  checkoutReference?: string
  providerPaymentReference?: string
  amount: number
  currency: string
  status: "paid" | "failed" | "refunded"
}

export type VerifiedWebhook =
  | { valid: true; event: NormalizedPaymentEvent }
  | { valid: false; reason: string }

/**
 * Everything a real gateway (Stripe, Paddle, ...) needs to implement to plug
 * into checkout + webhook confirmation. No adapter here calls a real network
 * endpoint — see providers/mock-provider.ts for the only implementation.
 */
export type PaymentProviderAdapter = {
  readonly name: string
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSession>
  verifyAndParseWebhook(input: {
    rawBody: string
    headers: Record<string, string | undefined>
  }): Promise<VerifiedWebhook>
}
