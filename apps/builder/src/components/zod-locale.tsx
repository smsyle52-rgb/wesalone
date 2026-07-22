"use client"

import { useLocale } from "next-intl"
import { z } from "zod"
import { ar } from "zod/locales"

// Zod's default (English) validation messages are developer-facing strings like
// "Too small: expected string to have >=1 characters" — meaningless to a
// merchant. Zod 4 ships localized message sets; wire the Arabic one up for
// Arabic users so form errors read as normal Arabic sentences. Runs on the
// client, where react-hook-form surfaces these messages in the UI.
let configured: string | null = null

export const ZodLocale = () => {
  const locale = useLocale()

  if (configured !== locale) {
    configured = locale
    if (locale === "ar") {
      z.config(ar())
    }
  }

  return null
}
