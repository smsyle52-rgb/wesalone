"use client"

import { ar, enUS } from "date-fns/locale"
import { useLocale } from "next-intl"

/**
 * The date-fns locale matching the interface language.
 *
 * date-fns falls back to English when no locale is passed, which is how an
 * otherwise Arabic page ended up showing "about 6 hours ago" next to every
 * contact. Only Arabic and English are selectable (`selectableLocales`), so
 * this maps those two and leaves everything else on English.
 */
export function useDateFnsLocale() {
  return useLocale() === "ar" ? ar : enUS
}
