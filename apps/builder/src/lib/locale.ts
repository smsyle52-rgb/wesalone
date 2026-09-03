"use server"

import { cookies, headers } from "next/headers"
import {
  defaultLocale,
  LOCALE_COOKIE,
  type Locale,
  parseLocale,
  resolveLocale,
} from "@/i18n/config"

// The locale lives in a cookie. `?lang=` writes that cookie in the middleware
// (see applyLocaleOverride in proxy.ts), which is what makes a locale
// shareable in a link.
const COOKIE_NAME = LOCALE_COOKIE

/**
 * A visitor who has never chosen a language used to get Arabic no matter where
 * they were: `Accept-Language` was never read. That is right for the merchants
 * this platform serves and wrong for everyone reviewing it from outside —
 * Google rejected a startup-credit application saying it could not identify the
 * product, having been served a page it could not read.
 *
 * Order now: an explicit choice (the cookie, written by `?lang=` or the
 * language switcher) always wins; then the browser's own preference; then
 * Arabic. An Arabic browser still lands on Arabic, and one click on the
 * switcher pins any choice for good.
 */
export async function getUserLocale() {
  const chosen = parseLocale((await cookies()).get(COOKIE_NAME)?.value)
  if (chosen) {
    return chosen
  }

  const acceptLanguage = (await headers()).get("accept-language")
  if (!acceptLanguage) {
    return defaultLocale
  }

  // "ar-YE,ar;q=0.9,en;q=0.8" → "ar-YE". `resolveLocale` maps the tag onto a
  // locale we actually ship and falls back to Arabic when it cannot.
  const preferred = acceptLanguage.split(",")[0]?.split(";")[0]?.trim()
  return resolveLocale(preferred)
}

export async function setUserLocale(locale: Locale) {
  ;(await cookies()).set(COOKIE_NAME, locale)
}
