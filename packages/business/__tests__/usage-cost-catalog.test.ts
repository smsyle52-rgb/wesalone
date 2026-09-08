import { describe, expect, test } from "vitest"
import {
  actualCostMicroUsd,
  COST_CATALOG_VERSION,
} from "../src/usage-metering/rates"

/**
 * `BillableUsageEvent.actualCostMicroUsd` shipped with the table and was never
 * written: 10,608 settled events over the 30 days to 8 Sep 2026, every one with
 * a null cost. Margin per workspace was therefore unknowable, and the plan
 * prices were set without a floor under them.
 */
describe("actualCostMicroUsd", () => {
  test("prices a Vertex Flash call at the published introductory rate", () => {
    // 1M input + 1M output at 0.75 / 3.75 USD per million.
    expect(
      actualCostMicroUsd("gemini-3.7-flash", {
        inputUnits: 1_000_000,
        outputUnits: 1_000_000,
      }),
    ).toBe(4_500_000n)
  })

  test("output is the expensive half, five times input", () => {
    const input = actualCostMicroUsd("gemini-3.7-flash", {
      inputUnits: 1_000_000,
    })
    const output = actualCostMicroUsd("gemini-3.7-flash", {
      outputUnits: 1_000_000,
    })
    expect(input).toBe(750_000n)
    expect(output).toBe(3_750_000n)
  })

  test("an unpriced model records unknown, never zero", () => {
    // The distinction matters: zero would read as a free call and quietly
    // inflate the margin, while null leaves the gap countable.
    expect(
      actualCostMicroUsd("chirp_3", { inputUnits: 5000, outputUnits: 0 }),
    ).toBeNull()
    expect(actualCostMicroUsd(null, { inputUnits: 5000 })).toBeNull()
    expect(actualCostMicroUsd(undefined, { inputUnits: 5000 })).toBeNull()
  })

  test("a call with no units costs nothing but is still priced", () => {
    expect(actualCostMicroUsd("gemini-3.7-flash", {})).toBe(0n)
  })

  test("negative or malformed unit counts do not produce a credit", () => {
    expect(
      actualCostMicroUsd("gemini-3.7-flash", {
        inputUnits: -1_000_000,
        outputUnits: Number.NaN,
      }),
    ).toBe(0n)
  })

  test("the catalog is dated, because the rate expires", () => {
    // Vertex introductory pricing runs to 31 Dec 2026 and then doubles. The
    // version string is what makes that visible when the numbers change.
    expect(COST_CATALOG_VERSION).toBe("2026-09-08.vertex-intro")
  })
})
