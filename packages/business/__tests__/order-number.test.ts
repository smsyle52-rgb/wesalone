import { describe, expect, test } from "vitest"

/**
 * The order number a customer is told has to be the one the merchant can find.
 *
 * Before this, `create_order` read the raw 17-digit snowflake out loud
 * ("سجّلت طلبك رقم 11686817378942976") while the merchant's own list rendered
 * `order.id.slice(-8)`. Two different numbers for one order: a customer who
 * quoted theirs named something that appeared nowhere in the merchant's
 * dashboard. A merchant reported it as "the order number is too long"; the
 * mismatch underneath was the worse half.
 */

/** Mirrors `nextOrderNumberSQL` in `order/service.ts`. */
const nextOrderNumber = (existing: number[]) =>
  (existing.length ? Math.max(...existing) : 4999) + 1

/** Mirrors the reference branch in `orderService.getByNumberOrId`. */
const looksLikeOrderNumber = (reference: string) =>
  /^\d{1,9}$/.test(reference.trim())

describe("order numbering", () => {
  test("a merchant's first order is 5000, not 1", () => {
    // The merchant's own request: a business whose first invoice reads #1
    // advertises that it has never sold anything.
    expect(nextOrderNumber([])).toBe(5000)
  })

  test("numbering continues from the workspace's own highest", () => {
    expect(nextOrderNumber([5000, 5001, 5002])).toBe(5003)
  })

  test("a gap from a deleted order is not reused", () => {
    // max+1, not count+1: reusing 5002 would give two orders the same number
    // in the merchant's records, which is worse than a gap.
    expect(nextOrderNumber([5000, 5001, 5003])).toBe(5004)
  })

  test("a short reference is looked up as an order number", () => {
    expect(looksLikeOrderNumber("5000")).toBe(true)
    expect(looksLikeOrderNumber(" 5231 ")).toBe(true)
  })

  test("a snowflake id is not tried as an order number", () => {
    // 17 digits overflows Postgres `integer`: querying it would error rather
    // than simply not match, so the id branch has to take it.
    expect(looksLikeOrderNumber("11686817378942976")).toBe(false)
  })

  test("a non-numeric reference is not tried as an order number", () => {
    expect(looksLikeOrderNumber("abc")).toBe(false)
    expect(looksLikeOrderNumber("")).toBe(false)
  })
})
