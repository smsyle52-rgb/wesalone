import { expect, test } from "vitest"
import { buildSignUpVerificationMjml } from "../src/emails/sign-up-verification"

const baseProps = {
  brandName: "وصال ون",
  brandLogoUrl: "https://wesal.one/brand/logo_white.svg",
  brandUrl: "https://wesal.one/",
  subject: "Verify your email address",
  userName: "أحمد",
  verificationUrl: "https://wesal.one/api/auth/verify-email?token=abc",
}

test("dir: rtl renders the Arabic body and button", () => {
  const mjml = buildSignUpVerificationMjml({ ...baseProps, dir: "rtl" })
  expect(mjml).toContain("تأكيد البريد الإلكتروني")
  expect(mjml).toContain("مرحبًا أحمد،")
  expect(mjml).not.toContain("Verify Email Address")
})

test("no dir (or ltr) keeps the original English body untouched", () => {
  const mjmlDefault = buildSignUpVerificationMjml(baseProps)
  const mjmlLtr = buildSignUpVerificationMjml({ ...baseProps, dir: "ltr" })
  expect(mjmlDefault).toContain("Verify Email Address")
  expect(mjmlDefault).toContain("Thanks for signing up!")
  expect(mjmlDefault).not.toContain("تأكيد البريد الإلكتروني")
  expect(mjmlLtr).toBe(mjmlDefault)
})

test("the verification URL is embedded in both languages", () => {
  const ar = buildSignUpVerificationMjml({ ...baseProps, dir: "rtl" })
  const en = buildSignUpVerificationMjml(baseProps)
  expect(ar).toContain(baseProps.verificationUrl)
  expect(en).toContain(baseProps.verificationUrl)
})
