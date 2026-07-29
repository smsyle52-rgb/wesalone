export type Locale = (typeof locales)[number]

export const locales = ["en", "ar"] as const
export const defaultLocale: Locale = "ar"

/** Where the chosen locale is remembered. Shared by the middleware and the server action. */
export const LOCALE_COOKIE = "NEXT_LOCALE"

/** `?lang=` pins the UI language for a link. See applyLocaleOverride in proxy.ts. */
export const LOCALE_QUERY_PARAM = "lang"

export function parseLocale(value: string | null | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null
}
