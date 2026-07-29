// @vitest-environment node

import { describe, expect, test } from "vitest"
import {
  defaultLocale,
  LOCALE_COOKIE,
  LOCALE_QUERY_PARAM,
  locales,
  parseLocale,
} from "../src/i18n/config"

describe("locale config", () => {
  test("Arabic stays the default", () => {
    expect(defaultLocale).toBe("ar")
  })

  test("accepts only the locales the app ships", () => {
    for (const locale of locales) {
      expect(parseLocale(locale)).toBe(locale)
    }
  })

  test("rejects anything else, so ?lang cannot write junk into the cookie", () => {
    for (const value of [
      null,
      undefined,
      "",
      "fr",
      "vi",
      "EN",
      "en-US",
      "ar; drop",
      "../../etc",
    ]) {
      expect(parseLocale(value), String(value)).toBeNull()
    }
  })

  test("the cookie and query names are the ones the middleware and server action share", () => {
    // getUserLocale reads LOCALE_COOKIE; the middleware writes it. If these
    // drift apart, ?lang silently stops working.
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE")
    expect(LOCALE_QUERY_PARAM).toBe("lang")
  })
})
