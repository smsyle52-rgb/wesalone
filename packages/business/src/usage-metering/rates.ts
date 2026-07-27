import type { BillableUsageCategory } from "@chatbotx.io/database/partials"
import { MICRO_POINTS_PER_POINT } from "../point-wallet/service"

export const USAGE_RATE_VERSION = "2026-07-27.v1"

export type LanguageUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
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
  const weightedQuarterUnits =
    uncached * 4 + cached + textOutput * 12 + reasoning * 20
  return BigInt(Math.max(1, Math.ceil(weightedQuarterUnits * 250)))
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
