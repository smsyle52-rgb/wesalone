/** ISO 4217 code a product falls back to when none was picked. */
export const DEFAULT_PRODUCT_CURRENCY = "USD"

/**
 * Currencies offered in the product form. Meta Catalog accepts any ISO 4217
 * code, so this is a shortlist for the picker — not a validation whitelist.
 *
 * Trimmed to the three currencies Wesal One's merchants actually price in:
 * the Yemeni rial they sell in, and the dollar and Saudi riyal they buy and
 * quote wholesale in. The upstream list was a South-East Asia shortlist with
 * no rial in it at all, so a Yemeni merchant had no correct option to pick.
 */
export const PRODUCT_CURRENCIES: readonly string[] = ["YER", "USD", "SAR"]

/** Money is fractional; react-number-format is integer-only by default. */
const PRICE_DECIMAL_SCALE = 2

/**
 * Both separators are accepted so a comma-decimal locale (vi-VN) and a
 * dot-decimal one (en-US) can type the same field and land on the same number.
 */
const PRICE_DECIMAL_SEPARATORS: string[] = [".", ","]

export const PRICE_INPUT_PROPS = {
  allowedDecimalSeparators: PRICE_DECIMAL_SEPARATORS,
  decimalScale: PRICE_DECIMAL_SCALE,
}
