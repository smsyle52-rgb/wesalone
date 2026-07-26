import { describe, expect, test } from "vitest"
import type { SimilaritySearchResult } from "../src/server/knowledge-base"
import { rankSearchResults } from "../src/server/knowledge-ranking"

const config = { maxResults: 2, similarityThreshold: 0.7 }

function result(
  id: string,
  content: string,
  distance: number,
): SimilaritySearchResult {
  return { aiFileId: "1", content, distance, id }
}

describe("knowledge-base hybrid ranking", () => {
  test("promotes an exact Arabic answer below the vector threshold", () => {
    const ranked = rankSearchResults(
      "كم سعر الاشتراك؟",
      [
        result("general", "منصة لإدارة رسائل العملاء", 0.81),
        result(
          "pricing",
          "سعر الاشتراك: Starter ١٩ دولارًا وGrowth ٤٩ دولارًا",
          0.59,
        ),
      ],
      config,
    )

    expect(ranked.map(({ id }) => id)).toEqual(["pricing", "general"])
  })

  test("preserves semantic ranking when the query has no literal match", () => {
    const ranked = rankSearchResults(
      "تفاصيل الخدمة",
      [
        result("best", "محتوى مختلف", 0.82),
        result("below-threshold", "محتوى آخر", 0.65),
      ],
      config,
    )

    expect(ranked.map(({ id }) => id)).toEqual(["best"])
  })
})
