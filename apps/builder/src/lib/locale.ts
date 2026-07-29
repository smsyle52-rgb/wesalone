"use server"

import { cookies } from "next/headers"
import {
  defaultLocale,
  LOCALE_COOKIE,
  type Locale,
  parseLocale,
} from "@/i18n/config"

// The locale lives in a cookie. `?lang=` writes that cookie in the middleware
// (see applyLocaleOverride in proxy.ts), which is what makes a locale
// shareable in a link.
const COOKIE_NAME = LOCALE_COOKIE

export async function getUserLocale() {
  const locale = (await cookies()).get(COOKIE_NAME)?.value
  return parseLocale(locale) ?? defaultLocale
}

export async function setUserLocale(locale: Locale) {
  ;(await cookies()).set(COOKIE_NAME, locale)
}
