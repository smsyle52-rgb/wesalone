export const locales = ["ar", "en"] as const

export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "ar"

export const localeMeta = {
  ar: { nativeLabel: "العربية", dir: "rtl" },
  en: { nativeLabel: "English", dir: "ltr" },
} satisfies Record<Locale, { nativeLabel: string; dir: "ltr" | "rtl" }>

/** Where the chosen locale is remembered. Shared by the middleware and the server action. */
export const LOCALE_COOKIE = "NEXT_LOCALE"

/** `?lang=` pins the UI language for a link. See applyLocaleOverride in proxy.ts. */
export const LOCALE_QUERY_PARAM = "lang"

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

export function parseLocale(value: string | null | undefined): Locale | null {
  return value && isLocale(value) ? value : null
}

export function resolveLocale(value: string | undefined): Locale {
  if (!value) {
    return defaultLocale
  }
  if (isLocale(value)) {
    return value
  }
  return value.split("-")[0] === "ar" ? "ar" : "en"
}
