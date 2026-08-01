import ar from "../../messages/ar.json"
import en from "../../messages/en.json"
import type { Locale } from "./config"

export const messagesByLocale: Record<Locale, Record<string, unknown>> = {
  ar,
  en,
}
