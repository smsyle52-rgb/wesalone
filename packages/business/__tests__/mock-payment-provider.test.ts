import { afterEach, describe, expect, test, vi } from "vitest"
import {
  buildMockSignatureHeader,
  mockPaymentProvider,
} from "../src/payment/providers/mock-provider"

const validEvent = {
  eventId: "evt_1",
  checkoutReference: "mock_cs_1",
  paymentReference: "pi_1",
  amount: 100,
  currency: "USD",
  status: "paid" as const,
}

describe("mockPaymentProvider.verifyAndParseWebhook", () => {
  afterEach(() => vi.unstubAllEnvs())

  test("accepts a correctly signed payload", async () => {
    const rawBody = JSON.stringify(validEvent)
    const signature = await buildMockSignatureHeader(rawBody)

    const result = await mockPaymentProvider.verifyAndParseWebhook({
      rawBody,
      headers: { "x-mock-payment-signature": signature },
    })

    expect(result).toMatchObject({
      valid: true,
      event: {
        providerEventId: "evt_1",
        amount: 100,
        currency: "USD",
        status: "paid",
      },
    })
  })

  test("rejects a missing signature header", async () => {
    const rawBody = JSON.stringify(validEvent)

    const result = await mockPaymentProvider.verifyAndParseWebhook({
      rawBody,
      headers: {},
    })

    expect(result.valid).toBe(false)
  })

  test("rejects a payload tampered with after signing", async () => {
    const rawBody = JSON.stringify(validEvent)
    const signature = await buildMockSignatureHeader(rawBody)
    const tamperedBody = JSON.stringify({ ...validEvent, amount: 1 })

    const result = await mockPaymentProvider.verifyAndParseWebhook({
      rawBody: tamperedBody,
      headers: { "x-mock-payment-signature": signature },
    })

    expect(result.valid).toBe(false)
  })

  test("rejects a signature computed with the wrong secret", async () => {
    const rawBody = JSON.stringify(validEvent)
    const timestamp = Math.floor(Date.now() / 1000)

    const result = await mockPaymentProvider.verifyAndParseWebhook({
      rawBody,
      headers: { "x-mock-payment-signature": `t=${timestamp},s=deadbeef` },
    })

    expect(result.valid).toBe(false)
  })

  test("rejects a stale timestamp outside the allowed window", async () => {
    const rawBody = JSON.stringify(validEvent)
    const staleTimestamp = Math.floor(Date.now() / 1000) - 10_000
    const signature = await buildMockSignatureHeader(rawBody, staleTimestamp)

    const result = await mockPaymentProvider.verifyAndParseWebhook({
      rawBody,
      headers: { "x-mock-payment-signature": signature },
    })

    expect(result.valid).toBe(false)
  })

  test("fails closed outside tests when no webhook secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_PAYMENT_WEBHOOK_SECRET", "")

    await expect(buildMockSignatureHeader("{}")).rejects.toThrow(
      "MOCK_PAYMENT_WEBHOOK_SECRET is required",
    )
  })
})
