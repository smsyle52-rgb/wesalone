import { describe, expect, test } from "vitest"
import {
  findWesalOnePlan,
  WESAL_ONE_PLANS,
} from "../src/platform/wesal-one-plans"

describe("WESAL_ONE_PLANS", () => {
  test("defines exactly the five documented plans, in order", () => {
    expect(WESAL_ONE_PLANS.map((plan) => plan.slug)).toEqual([
      "free",
      "starter",
      "growth",
      "professional",
      "business",
    ])
  })

  test("every non-custom plan has a non-negative monthly USD price", () => {
    for (const plan of WESAL_ONE_PLANS) {
      if (plan.slug === "business") {
        continue
      }
      expect(plan.priceMonthlyUsd).not.toBeNull()
      expect(plan.priceMonthlyUsd as number).toBeGreaterThanOrEqual(0)
    }
  })

  test("the business plan is custom-priced with no fixed limits", () => {
    const business = findWesalOnePlan("business")
    expect(business).toMatchObject({
      priceMonthlyUsd: null,
      priceYearlyUsd: null,
      monthlyPoints: null,
      limits: { channels: null, contacts: null, teamMembers: null },
    })
  })

  test("the free plan matches the documented source values exactly", () => {
    const free = findWesalOnePlan("free")
    expect(free).toMatchObject({
      priceMonthlyUsd: 0,
      monthlyPoints: 1000,
      limits: { channels: 1, contacts: 100, teamMembers: 1 },
      autoReply: false,
    })
  })

  test("exactly one plan is highlighted (growth, per the documented source)", () => {
    const highlighted = WESAL_ONE_PLANS.filter((plan) => plan.highlighted)
    expect(highlighted.map((plan) => plan.slug)).toEqual(["growth"])
  })

  test("channel/contact/team-member limits only ever increase or go custom from tier to tier", () => {
    const tiers = WESAL_ONE_PLANS.filter((plan) => plan.slug !== "business")
    for (let i = 1; i < tiers.length; i++) {
      const prev = tiers[i - 1]
      const curr = tiers[i]
      expect(curr.limits.channels).toBeGreaterThanOrEqual(
        prev.limits.channels ?? 0,
      )
      expect(curr.limits.contacts).toBeGreaterThanOrEqual(
        prev.limits.contacts ?? 0,
      )
      expect(curr.limits.teamMembers).toBeGreaterThanOrEqual(
        prev.limits.teamMembers ?? 0,
      )
    }
  })

  test("findWesalOnePlan() returns undefined for an unknown slug instead of throwing", () => {
    expect(findWesalOnePlan("nonexistent")).toBeUndefined()
  })
})
