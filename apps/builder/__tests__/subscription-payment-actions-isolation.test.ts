import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

const ACTIONS_DIR = join(import.meta.dirname, "../src/features/plans/actions")
const BUSINESS_IMPORT_PATTERN =
  /import\s*\{([^}]+)\}\s*from\s*"@chatbotx\.io\/business"/
const SUPER_ADMIN_CLIENT_PATTERN = /superAdminActionClient/
const WORKSPACE_CLIENT_PATTERN = /workspaceActionClient/
const FEATURE_FLAG_PATTERN = /isPlatformSubscriptionPaymentsEnabled/

// Blocklist substrings deliberately exclude generic fragments like
// "paymentService" — this file legitimately imports
// platformSubscriptionPaymentService, whose lowercased name contains that
// exact fragment, so a naive substring check false-positives on itself.
// The allowlist import check below is the precise version of that guard.
const FORBIDDEN_TERMS = [
  "orderservice",
  "features/orders",
  "packages/business/src/payment",
  "stripe",
  "checkout.com",
]

function readAction(file: string): { source: string; code: string } {
  const source = readFileSync(join(ACTIONS_DIR, file), "utf8")
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  return { source, code }
}

function businessImports(source: string): string[] {
  const match = source.match(BUSINESS_IMPORT_PATTERN)
  return (match?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

// Comment-stripped `code` (not raw `source`) is deliberate for the negative
// assertions below — the actions' own doc-comments explain in prose which
// client each one deliberately does NOT use, which would otherwise
// false-positive a raw-source substring/regex check.
describe("subscription-payment actions — trust boundary (self-approval must be impossible)", () => {
  test("confirm action is super-admin-only (same gate as the rest of /admin), never workspace-scoped", () => {
    const { code } = readAction("confirm-subscription-payment.action.ts")
    expect(code).toMatch(SUPER_ADMIN_CLIENT_PATTERN)
    expect(code).not.toMatch(WORKSPACE_CLIENT_PATTERN)
  })

  test("reject action is super-admin-only, never workspace-scoped", () => {
    const { code } = readAction("reject-subscription-payment.action.ts")
    expect(code).toMatch(SUPER_ADMIN_CLIENT_PATTERN)
    expect(code).not.toMatch(WORKSPACE_CLIENT_PATTERN)
  })

  test("submit action is workspace-scoped (a customer submits their own claim), not super-admin", () => {
    const { code } = readAction("submit-subscription-payment.action.ts")
    expect(code).toMatch(WORKSPACE_CLIENT_PATTERN)
    expect(code).not.toMatch(SUPER_ADMIN_CLIENT_PATTERN)
  })

  test("cancel action is workspace-scoped, not super-admin", () => {
    const { code } = readAction("cancel-subscription-payment.action.ts")
    expect(code).toMatch(WORKSPACE_CLIENT_PATTERN)
    expect(code).not.toMatch(SUPER_ADMIN_CLIENT_PATTERN)
  })

  test("submit action checks the feature flag before doing anything else", () => {
    const { source } = readAction("submit-subscription-payment.action.ts")
    expect(source).toMatch(FEATURE_FLAG_PATTERN)
  })
})

describe("subscription-payment actions — platform/order-payment isolation", () => {
  const files = [
    "submit-subscription-payment.action.ts",
    "cancel-subscription-payment.action.ts",
    "confirm-subscription-payment.action.ts",
    "reject-subscription-payment.action.ts",
  ]

  for (const file of files) {
    test(`${file} never imports order, checkout, or Stripe code`, () => {
      const { code } = readAction(file)
      for (const term of FORBIDDEN_TERMS) {
        expect(code.toLowerCase()).not.toContain(term.toLowerCase())
      }
    })

    test(`${file} only touches platformSubscriptionPaymentService from @chatbotx.io/business`, () => {
      const { source } = readAction(file)
      expect(businessImports(source)).toEqual([
        "platformSubscriptionPaymentService",
      ])
    })
  }
})

describe("submit-subscription-payment request schema — price is never client input, receipt is never a bare URL", () => {
  test("the submit schema defines no amount/price field, and no receiptUrl field", async () => {
    const { submitSubscriptionPaymentRequest } = await import(
      "../src/features/plans/schema/subscription-payment-action"
    )
    const shape = submitSubscriptionPaymentRequest.shape
    expect(shape).not.toHaveProperty("amount")
    expect(shape).not.toHaveProperty("price")
    expect(shape).not.toHaveProperty("priceUsd")
    expect(shape).not.toHaveProperty("receiptUrl")
    expect(shape).toHaveProperty("receiptFileId")
  })

  test("the submit schema requires a receiptFileId — a payment cannot be submitted without an uploaded receipt", async () => {
    const { submitSubscriptionPaymentRequest } = await import(
      "../src/features/plans/schema/subscription-payment-action"
    )
    const result = submitSubscriptionPaymentRequest.safeParse({
      planSlug: "growth",
      billingCycle: "monthly",
      paymentMethod: "bank_transfer",
    })
    expect(result.success).toBe(false)
  })

  test("the submit schema rejects a plan slug outside the payable set", async () => {
    const { submitSubscriptionPaymentRequest } = await import(
      "../src/features/plans/schema/subscription-payment-action"
    )
    const result = submitSubscriptionPaymentRequest.safeParse({
      planSlug: "not-a-real-plan",
      billingCycle: "monthly",
      paymentMethod: "bank_transfer",
      receiptFileId: "123",
    })
    expect(result.success).toBe(false)
  })

  test("the submit schema rejects the free and business plans (nothing payable there)", async () => {
    const { submitSubscriptionPaymentRequest } = await import(
      "../src/features/plans/schema/subscription-payment-action"
    )
    for (const planSlug of ["free", "business"]) {
      const result = submitSubscriptionPaymentRequest.safeParse({
        planSlug,
        billingCycle: "monthly",
        paymentMethod: "bank_transfer",
        receiptFileId: "123",
      })
      expect(result.success).toBe(false)
    }
  })
})
