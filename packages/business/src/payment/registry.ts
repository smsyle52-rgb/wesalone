import { ChatbotXException } from "../errors"
import type { PaymentProviderAdapter } from "./provider"
import { mockPaymentProvider } from "./providers/mock-provider"

// Adding a real gateway later: implement PaymentProviderAdapter in
// providers/<name>-provider.ts and add one entry here — no schema migration
// needed (Payment.provider is a free-form column, not an enum).
const providers: Record<string, PaymentProviderAdapter> =
  process.env.NODE_ENV === "production" ? {} : { mock: mockPaymentProvider }

export const getPaymentProvider = (name: string): PaymentProviderAdapter => {
  const provider = providers[name]
  if (!provider) {
    throw new ChatbotXException(
      `Unknown payment provider: ${name}`,
      "unknownPaymentProvider",
      400,
    )
  }
  return provider
}
