import { expect, test } from "vitest"
import { buildResetPasswordMjml } from "../src/emails/reset-password"
import { buildSignInMagicLinkMjml } from "../src/emails/sign-in-magic-link"
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

const resetProps = {
  ...baseProps,
  subject: "Reset your password",
  resetPasswordUrl: "https://wesal.one/auth/reset-password?token=abc",
}

test("reset password: rtl renders Arabic, default stays English", () => {
  const ar = buildResetPasswordMjml({ ...resetProps, dir: "rtl" })
  const en = buildResetPasswordMjml(resetProps)
  expect(ar).toContain("إعادة تعيين كلمة المرور")
  expect(ar).not.toContain("Reset Password")
  expect(en).toContain("Reset Password")
  expect(en).not.toContain("إعادة تعيين كلمة المرور")
  expect(ar).toContain(resetProps.resetPasswordUrl)
  expect(en).toContain(resetProps.resetPasswordUrl)
})

const magicProps = {
  ...baseProps,
  magicUrl: "https://wesal.one/auth/magic?token=abc",
}

test("magic link: rtl renders Arabic with the brand name interpolated", () => {
  // The subject is rendered inside the body by buildSystemEmail, so each
  // language gets the subject it would really be sent with.
  const ar = buildSignInMagicLinkMjml({
    ...magicProps,
    subject: "تسجيل الدخول إلى وصال ون",
    dir: "rtl",
  })
  const en = buildSignInMagicLinkMjml({
    ...magicProps,
    subject: "Sign in to وصال ون",
  })
  expect(ar).toContain("تسجيل الدخول إلى وصال ون")
  expect(ar).not.toContain("{{brandName}}")
  expect(ar).not.toContain("Sign in to")
  expect(en).toContain("Sign in to")
  expect(ar).toContain(magicProps.magicUrl)
  expect(en).toContain(magicProps.magicUrl)
})

// The Arabic body used to still close with the English default sign-off.
test.each([
  [
    "sign-up",
    (p: Record<string, unknown>) => buildSignUpVerificationMjml(p as never),
  ],
  [
    "reset-password",
    (p: Record<string, unknown>) => buildResetPasswordMjml(p as never),
  ],
  [
    "magic-link",
    (p: Record<string, unknown>) => buildSignInMagicLinkMjml(p as never),
  ],
])("%s: the Arabic email signs off in Arabic", (_name, build) => {
  const ar = build({
    ...baseProps,
    subject: "اختبار",
    resetPasswordUrl: resetProps.resetPasswordUrl,
    magicUrl: magicProps.magicUrl,
    dir: "rtl",
  })
  expect(ar).toContain("مع التحية،")
  expect(ar).not.toContain("Sincerely,")
  expect(ar).not.toContain("Team")
})
