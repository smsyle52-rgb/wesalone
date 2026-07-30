import { expect, test } from "vitest"
import { getLocaleFromRequest } from "../src/request"

const requestWithCookie = (cookie?: string) =>
  new Request("https://wesal.one/api/auth/sign-up/email", {
    headers: cookie ? { cookie } : {},
  })

test("defaults to ar when there is no NEXT_LOCALE cookie", () => {
  expect(getLocaleFromRequest(requestWithCookie())).toBe("ar")
})

test("reads en from the NEXT_LOCALE cookie", () => {
  expect(getLocaleFromRequest(requestWithCookie("NEXT_LOCALE=en"))).toBe("en")
})

test("reads ar from the NEXT_LOCALE cookie", () => {
  expect(getLocaleFromRequest(requestWithCookie("NEXT_LOCALE=ar"))).toBe("ar")
})

test("finds NEXT_LOCALE among other cookies", () => {
  expect(
    getLocaleFromRequest(
      requestWithCookie("session=abc123; NEXT_LOCALE=en; theme=dark"),
    ),
  ).toBe("en")
})

test("falls back to ar for an unrecognized locale value", () => {
  expect(getLocaleFromRequest(requestWithCookie("NEXT_LOCALE=fr"))).toBe("ar")
})
