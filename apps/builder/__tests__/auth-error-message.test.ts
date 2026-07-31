import { describe, expect, test } from "vitest"
import {
  authErrorMessage,
  isEmailNotVerified,
} from "@/features/auth/lib/auth-error-message"

// Stands in for `useTranslations("auth")`: returns the key so the test asserts
// which message was chosen, not the copy itself.
const t = (key: string) => key

describe("authErrorMessage", () => {
  test("maps a wrong password to the Arabic-translatable key, not better-auth's English text", () => {
    const error = {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    }
    expect(authErrorMessage(error, t)).toBe("errorInvalidEmailOrPassword")
  })

  test("maps an unverified email to its own key", () => {
    expect(
      authErrorMessage({ code: "EMAIL_NOT_VERIFIED", message: "x" }, t),
    ).toBe("errorEmailNotVerified")
  })

  test.each([
    ["USER_NOT_FOUND", "errorUserNotFound"],
    ["USER_ALREADY_EXISTS", "errorUserAlreadyExists"],
    ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "errorUserAlreadyExists"],
    ["INVALID_EMAIL", "errorInvalidEmail"],
    ["PASSWORD_TOO_SHORT", "errorPasswordTooShort"],
    ["TOKEN_EXPIRED", "errorTokenExpired"],
    ["SESSION_EXPIRED", "errorSessionExpired"],
  ])("maps %s", (code, expected) => {
    expect(authErrorMessage({ code }, t)).toBe(expected)
  })

  // The whole point: never leak an untranslated internal string to a merchant.
  test("falls back to the generic key for an unknown code", () => {
    expect(
      authErrorMessage({ code: "SOME_FUTURE_CODE", message: "Raw text" }, t),
    ).toBe("errorGeneric")
  })

  test("falls back when there is no code at all", () => {
    expect(authErrorMessage({ message: "Raw text" }, t)).toBe("errorGeneric")
    expect(authErrorMessage(null, t)).toBe("errorGeneric")
    expect(authErrorMessage(undefined, t)).toBe("errorGeneric")
  })
})

describe("isEmailNotVerified", () => {
  test("is true only for the unverified-email code", () => {
    expect(isEmailNotVerified({ code: "EMAIL_NOT_VERIFIED" })).toBe(true)
    expect(isEmailNotVerified({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      false,
    )
    expect(isEmailNotVerified(null)).toBe(false)
    expect(isEmailNotVerified(undefined)).toBe(false)
  })
})
