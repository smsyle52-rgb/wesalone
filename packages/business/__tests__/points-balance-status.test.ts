import { describe, expect, test } from "vitest"
import {
  classifyPointsBalance,
  pointsNoticeStatus,
} from "../src/point-wallet/balance-status"

describe("classifyPointsBalance", () => {
  test("is depleted below one reply's reservation (50 points)", () => {
    expect(
      classifyPointsBalance({
        totalAvailablePoints: 49,
        monthlyGrantedPoints: 10_000,
      }),
    ).toBe("depleted")
    expect(
      classifyPointsBalance({
        totalAvailablePoints: 0,
        monthlyGrantedPoints: 0,
      }),
    ).toBe("depleted")
  })

  test("is low at 20% of the plan allowance", () => {
    expect(
      classifyPointsBalance({
        totalAvailablePoints: 2000,
        monthlyGrantedPoints: 10_000,
      }),
    ).toBe("low")
    expect(
      classifyPointsBalance({
        totalAvailablePoints: 2001,
        monthlyGrantedPoints: 10_000,
      }),
    ).toBeNull()
  })

  test("still warns a small plan through the 250-point floor", () => {
    expect(
      classifyPointsBalance({
        totalAvailablePoints: 240,
        monthlyGrantedPoints: 1000,
      }),
    ).toBe("low")
  })
})

describe("pointsNoticeStatus", () => {
  test("during the grace period only a would-be-stopped owner is warned", () => {
    const grace = { graceActive: true }
    expect(
      pointsNoticeStatus(
        { totalAvailablePoints: 0, monthlyGrantedPoints: 0 },
        grace,
      ),
    ).toBe("grace")
    expect(
      pointsNoticeStatus(
        { totalAvailablePoints: 100, monthlyGrantedPoints: 10_000 },
        grace,
      ),
    ).toBeNull()
  })

  test("once enforced it reports the balance itself", () => {
    expect(
      pointsNoticeStatus(
        { totalAvailablePoints: 0, monthlyGrantedPoints: 0 },
        { graceActive: false },
      ),
    ).toBe("depleted")
  })
})
