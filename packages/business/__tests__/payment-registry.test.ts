import { afterEach, describe, expect, test, vi } from "vitest"

describe("payment provider registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  test("does not expose the mock provider in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const { getPaymentProvider } = await import("../src/payment/registry")

    expect(() => getPaymentProvider("mock")).toThrow()
  })
})
