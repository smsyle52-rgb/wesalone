import type { BillableUsageCategory } from "@chatbotx.io/database/partials"
import { MICRO_POINTS_PER_POINT } from "../point-wallet/service"

export const USAGE_RATE_VERSION = "2026-07-27.v1"

export type LanguageUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  webSearches?: number
}

const safeUnits = (value: number | undefined) =>
  Number.isFinite(value) && value && value > 0 ? Math.ceil(value) : 0

// One point buys 1,000 weighted units. Output and reasoning are intentionally
// weighted higher because they cost materially more across model providers.
export const languageUsageMicroPoints = (usage: LanguageUsage): bigint => {
  const input = safeUnits(usage.inputTokens)
  const cached = Math.min(input, safeUnits(usage.cachedInputTokens))
  const uncached = input - cached
  const output = safeUnits(usage.outputTokens)
  const reasoning = Math.min(output, safeUnits(usage.reasoningTokens))
  const textOutput = output - reasoning
  const webSearches = safeUnits(usage.webSearches)
  const weightedQuarterUnits =
    uncached * 4 + cached + textOutput * 12 + reasoning * 20
  const languageMicroPoints = Math.max(1, Math.ceil(weightedQuarterUnits * 250))
  return (
    BigInt(languageMicroPoints) +
    BigInt(webSearches) * 5n * MICRO_POINTS_PER_POINT
  )
}

export const unitUsageMicroPoints = (
  category: BillableUsageCategory,
  units: number,
): bigint => {
  const value = safeUnits(units)
  const points = (() => {
    switch (category) {
      case "transcription":
        return value / 60 // seconds -> one point per minute
      case "speech":
        return value / 1000 // characters
      case "embedding_document":
      case "embedding_query":
      case "knowledge_search":
        return value / 5000 // tokens/estimated units
      case "image_analysis":
        return value / 1000
      case "image_generation":
        return value * 20 // images
      case "image_editing":
        return value * 25 // images
      case "web_search":
        return value * 5 // searches
      case "tool":
        return value // invocations
      case "summarization":
      case "language":
        return value / 1000
      default:
        return value / 1000
    }
  })()
  return BigInt(Math.max(1, Math.ceil(points * Number(MICRO_POINTS_PER_POINT))))
}

export const defaultReservationMicroPoints = (
  category: BillableUsageCategory,
): bigint => {
  switch (category) {
    case "image_generation":
      return 20n * MICRO_POINTS_PER_POINT
    case "image_editing":
      return 25n * MICRO_POINTS_PER_POINT
    case "transcription":
      return 30n * MICRO_POINTS_PER_POINT
    case "speech":
      return 10n * MICRO_POINTS_PER_POINT
    case "embedding_document":
      return 100n * MICRO_POINTS_PER_POINT
    case "web_search":
      return 10n * MICRO_POINTS_PER_POINT
    default:
      return 50n * MICRO_POINTS_PER_POINT
  }
}

/**
 * What a call actually costs us, in USD — the number the points catalog above
 * deliberately does not carry.
 *
 * `BillableUsageEvent.actualCostMicroUsd` existed from the start and was never
 * written: 10,608 settled events over the 30 days to 8 Sep 2026, zero with a
 * cost. Pricing was therefore guesswork — there was no way to tell a workspace
 * that earns from one that loses, or to know what a plan's grant is worth.
 *
 * Rates are USD per 1,000,000 tokens, transcribed from Google's published
 * Vertex AI pricing (checked 8 Sep 2026). Gemini 3.x Flash carries introductory
 * pricing through 31 Dec 2026; from 1 Jan 2027 it doubles to 1.50 / 7.50, which
 * is why this table is versioned and dated rather than inlined at the call site.
 *
 * A model absent from this table yields `null`, never a guess: an unpriced call
 * is recorded as unknown, so the gap stays visible instead of quietly polluting
 * the margin figures. Cached input bills at the uncached rate here — a
 * deliberate over-estimate, so the recorded cost is never lower than reality.
 */
export const COST_CATALOG_VERSION = "2026-09-08.vertex-intro"

const MICRO_USD_PER_USD = 1_000_000
const TOKENS_PER_UNIT_PRICE = 1_000_000

type ModelPriceUsd = { inputPerMillion: number; outputPerMillion: number }

const MODEL_PRICE_USD: Record<string, ModelPriceUsd> = {
  "gemini-3.7-flash": { inputPerMillion: 0.75, outputPerMillion: 3.75 },
}

export type ActualCostUnits = {
  inputUnits?: number
  outputUnits?: number
}

/**
 * Returns the call's cost in micro-USD, or `null` when the model has no
 * published rate in this catalog.
 */
export const actualCostMicroUsd = (
  model: string | null | undefined,
  units: ActualCostUnits,
): bigint | null => {
  const price = model ? MODEL_PRICE_USD[model] : undefined
  if (!price) {
    return null
  }
  const input = safeUnits(units.inputUnits)
  const output = safeUnits(units.outputUnits)
  const usd =
    (input / TOKENS_PER_UNIT_PRICE) * price.inputPerMillion +
    (output / TOKENS_PER_UNIT_PRICE) * price.outputPerMillion
  return BigInt(Math.round(usd * MICRO_USD_PER_USD))
}
