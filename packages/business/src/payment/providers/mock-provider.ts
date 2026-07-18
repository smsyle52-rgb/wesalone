import { createId } from "@chatbotx.io/utils"
import { hmacSha256Hex, timingSafeStringEqual } from "@chatbotx.io/utils/crypto"
import { z } from "zod"
import type {
  CheckoutSession,
  CreateCheckoutSessionInput,
  PaymentProviderAdapter,
  VerifiedWebhook,
} from "../provider"

const SIGNATURE_HEADER = "x-mock-payment-signature"
// Dev/test-only provider — generous window, there is no real clock skew to
// defend against since nothing crosses a network boundary.
const SIGNATURE_WINDOW_SECONDS = 300

const mockWebhookEventSchema = z.object({
  eventId: z.string().min(1),
  checkoutReference: z.string().optional(),
  paymentReference: z.string().optional(),
  amount: z.number(),
  currency: z.string().min(1),
  status: z.enum(["paid", "failed", "refunded"]),
})

const getMockWebhookSecret = () => {
  const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET
  if (secret) {
    return secret
  }
  if (process.env.NODE_ENV === "test") {
    return "mock-payment-test-secret"
  }
  throw new Error("MOCK_PAYMENT_WEBHOOK_SECRET is required")
}

/** Test/dev helper to build a validly-signed header for this provider. */
export const buildMockSignatureHeader = async (
  rawBody: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<string> => {
  const signature = await hmacSha256Hex(
    getMockWebhookSecret(),
    `${timestamp}.${rawBody}`,
  )
  return `t=${timestamp},s=${signature}`
}

class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = "mock"

  // biome-ignore lint/suspicious/useAwait: interface is async for real providers
  async createCheckoutSession(
    _input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSession> {
    return {
      provider: this.name,
      checkoutReference: `mock_cs_${createId()}`,
    }
  }

  async verifyAndParseWebhook(input: {
    rawBody: string
    headers: Record<string, string | undefined>
  }): Promise<VerifiedWebhook> {
    const signatureHeader = input.headers[SIGNATURE_HEADER]
    if (!signatureHeader) {
      return { valid: false, reason: "Missing signature header" }
    }

    const parts = signatureHeader.split(",")
    const timestampPart = parts.find((part) => part.startsWith("t="))
    const signaturePart = parts.find((part) => part.startsWith("s="))
    if (!(timestampPart && signaturePart)) {
      return { valid: false, reason: "Malformed signature header" }
    }

    const timestamp = Number(timestampPart.slice(2))
    if (!Number.isFinite(timestamp)) {
      return { valid: false, reason: "Malformed signature timestamp" }
    }
    if (
      Math.abs(Math.floor(Date.now() / 1000) - timestamp) >
      SIGNATURE_WINDOW_SECONDS
    ) {
      return { valid: false, reason: "Signature timestamp outside window" }
    }

    const expected = await hmacSha256Hex(
      getMockWebhookSecret(),
      `${timestamp}.${input.rawBody}`,
    )
    if (!timingSafeStringEqual(expected, signaturePart.slice(2))) {
      return { valid: false, reason: "Signature mismatch" }
    }

    let payload: unknown
    try {
      payload = JSON.parse(input.rawBody)
    } catch {
      return { valid: false, reason: "Invalid JSON payload" }
    }

    const parsed = mockWebhookEventSchema.safeParse(payload)
    if (!parsed.success) {
      return { valid: false, reason: "Payload failed schema validation" }
    }

    return {
      valid: true,
      event: {
        providerEventId: parsed.data.eventId,
        checkoutReference: parsed.data.checkoutReference,
        providerPaymentReference: parsed.data.paymentReference,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        status: parsed.data.status,
      },
    }
  }
}

export const mockPaymentProvider = new MockPaymentProvider()
