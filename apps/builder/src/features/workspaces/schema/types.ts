import { getAllCountries, getAllTimezones } from "countries-and-timezones"
import { localeMeta, locales, selectableLocales } from "@/i18n/config"

export const UNKNOWN_COUNTRY = "unknown"
export const allCountryCodes = [
  UNKNOWN_COUNTRY,
  ...Object.keys(getAllCountries()),
]
export const allCountryOptions = [
  { value: UNKNOWN_COUNTRY, label: "Unknown" },
  ...Object.values(getAllCountries()).map((country) => ({
    value: country.id,
    label: country.name,
  })),
]

export const allSupportedLanguages = selectableLocales.map((locale) => ({
  label: localeMeta[locale].nativeLabel,
  value: locale,
}))
// Deliberately NOT derived from the options above: a workspace created before
// the UI narrowed can still hold any shipped locale, and validating against the
// short list would reject its own stored value the next time someone saves this
// form for an unrelated reason.
export const allLanguageCodes = locales.map((locale) => locale as string)

export const allTimezoneOptions = Object.values(getAllTimezones()).map(
  (timezone) => ({
    value: timezone.name,
    label: timezone.name,
  }),
)
export const allTimezoneCodes = Object.keys(getAllTimezones())

export const UNKNOWN_CONTINENT = "unknown"
export const allContinentOptions = [
  { value: UNKNOWN_CONTINENT, label: "Unknown" },
  { value: "AS", label: "Asia" },
  { value: "EU", label: "Europe" },
  { value: "AF", label: "Africa" },
  { value: "OC", label: "Australia" },
  { value: "NA", label: "North America" },
  { value: "SA", label: "South America" },
]
