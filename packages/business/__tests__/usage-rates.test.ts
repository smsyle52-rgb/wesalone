import { describe, expect, it } from "vitest"
import { addMonthsUtc } from "../src/platform-subscription/service"
import { toMicroPoints, toVisiblePoints } from "../src/point-wallet/service"
import {
  languageUsageMicroPoints,
  unitUsageMicroPoints,
} from "../src/usage-metering/rates"

describe("usage rate catalog", () => {
  it("charges cached input less than uncached input", () => {
    const uncached = languageUsageMicroPoints({ inputTokens: 1000 })
    const cached = languageUsageMicroPoints({
      inputTokens: 1000,
      cachedInputTokens: 1000,
    })
    expect(uncached).toBe(1_000_000n)
    expect(cached).toBe(250_000n)
  })

  it("weights output and reasoning above input", () => {
    expect(languageUsageMicroPoints({ outputTokens: 1000 })).toBe(3_000_000n)
    expect(
      languageUsageMicroPoints({
        outputTokens: 1000,
        reasoningTokens: 1000,
      }),
    ).toBe(5_000_000n)
  })

  it("keeps fractional point precision", () => {
    expect(toMicroPoints(0.125)).toBe(125_000n)
    expect(toVisiblePoints(125_000n)).toBe(0.125)
    expect(unitUsageMicroPoints("speech", 250)).toBe(250_000n)
    expect(unitUsageMicroPoints("transcription", 30)).toBe(500_000n)
  })

  it("anchors month-end billing without skipping a month", () => {
    expect(
      addMonthsUtc(new Date("2026-01-31T12:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-02-28T12:00:00.000Z")
    expect(
      addMonthsUtc(new Date("2024-01-31T12:00:00.000Z"), 1).toISOString(),
    ).toBe("2024-02-29T12:00:00.000Z")
  })
})
