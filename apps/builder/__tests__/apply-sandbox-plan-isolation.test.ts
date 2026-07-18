import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

const BUSINESS_IMPORT_PATTERN =
  /import\s*\{([^}]+)\}\s*from\s*"@chatbotx\.io\/business"/

// Architectural fitness check: the platform-subscription sandbox action must
// stay fully isolated from customer order/payment code. A source-text check
// (rather than a mocked call-count assertion) is deliberate here — it fails
// the moment anyone adds an import to order/payment/checkout/Stripe code,
// which a call-count assertion on an already-isolated file would not catch.
describe("applySandboxPlanAction — platform/order-payment isolation", () => {
  const source = readFileSync(
    join(
      import.meta.dirname,
      "../src/features/plans/actions/apply-sandbox-plan.action.ts",
    ),
    "utf8",
  )
  // Strip comments first — this file's own doc-comment explains, in prose,
  // that it does NOT touch Stripe/payment code, which would otherwise
  // false-positive a naive substring check. Only the executable code should
  // be held to "never mentions these terms".
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  test("never imports order, payment, checkout, or Stripe code", () => {
    const forbidden = [
      "orderService",
      "paymentService",
      "getPaymentProvider",
      "features/orders",
      "packages/business/src/payment",
      "stripe",
      "checkout",
    ]
    for (const term of forbidden) {
      expect(code.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })

  test("only touches userQuotaService and workspaceService from @chatbotx.io/business", () => {
    const importMatch = source.match(BUSINESS_IMPORT_PATTERN)
    expect(importMatch).not.toBeNull()
    const imported = (importMatch?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    expect(imported.sort()).toEqual(
      ["findWesalOnePlan", "userQuotaService", "workspaceService"].sort(),
    )
  })

  // rule 10 (Phase 4): the sandbox switcher must be forbidden in production —
  // real activation goes through the reviewed subscription-payment flow.
  test("rejects with NODE_ENV=production before any auth/workspace lookup runs", () => {
    const actionBody = source.slice(source.indexOf(".action(async ("))
    const guardIndex = actionBody.indexOf('NODE_ENV === "production"')
    const authLookupIndex = actionBody.indexOf(
      "getCurrentUserAndTargetWorkspace",
    )
    expect(guardIndex).toBeGreaterThan(-1)
    expect(authLookupIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(authLookupIndex)
  })
})
