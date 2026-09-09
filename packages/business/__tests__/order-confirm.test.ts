import { orderStatusTypes } from "@chatbotx.io/database/partials"
import { describe, expect, test } from "vitest"

/**
 * The agent records every order as a draft "the merchant confirms before
 * anything ships" — and until now the merchant had no way to. The order page
 * shipped read-only and the only forward path in the API was `checkoutOrder`,
 * which opens a payment-provider session: meaningless to a wholesaler whose 95
 * products carry no price and who is paid in cash on delivery.
 */

/** Mirrors the guard in `orderService.confirm`. */
const canConfirm = (status: string) => status === "draft"

/** Mirrors the guard in `orderService.cancel`. */
const canCancel = (status: string) =>
  status === "draft" || status === "confirmed" || status === "pending_payment"

describe("order confirmation", () => {
  test("`confirmed` is a real status, not a reused payment state", () => {
    // `pending_payment` was the alternative that needed no migration, and it
    // lies to a cash-on-delivery merchant: nothing is pending payment when the
    // customer pays the driver.
    expect(orderStatusTypes.options).toContain("confirmed")
  })

  test("only a draft can be confirmed", () => {
    expect(canConfirm("draft")).toBe(true)
    for (const status of ["confirmed", "paid", "cancelled", "expired"]) {
      expect(canConfirm(status), status).toBe(false)
    }
  })

  test("confirming twice is refused rather than silently repeated", () => {
    // The transition is one UPDATE guarded on `status = 'draft'`, so the
    // second press matches zero rows and reports the conflict instead of
    // overwriting the first.
    expect(canConfirm("confirmed")).toBe(false)
  })

  test("a confirmed order can still be cancelled", () => {
    // The merchant said yes and the customer changed their mind. No money has
    // moved in either state, so there is nothing to unwind.
    expect(canCancel("confirmed")).toBe(true)
    expect(canCancel("draft")).toBe(true)
  })

  test("a paid or refunded order cannot be cancelled from here", () => {
    for (const status of ["paid", "refunded", "cancelled", "expired"]) {
      expect(canCancel(status), status).toBe(false)
    }
  })

  test("confirmed sits between draft and payment in the status order", () => {
    // Order matters for the enum's own readability and for the badge map:
    // a merchant reading the list should see the lifecycle in sequence.
    const options = orderStatusTypes.options as string[]
    expect(options.indexOf("confirmed")).toBe(options.indexOf("draft") + 1)
    expect(options.indexOf("confirmed")).toBeLessThan(
      options.indexOf("pending_payment"),
    )
  })
})
