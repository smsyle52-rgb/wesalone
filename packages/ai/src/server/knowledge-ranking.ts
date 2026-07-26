import type { FileSearchConfig, SimilaritySearchResult } from "./knowledge-base"

const ARABIC_DIACRITICS = /[\u064b-\u065f\u0670]/g
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu
const ARABIC_DEFINITE_ARTICLE = /^\u0627\u0644/u
const SEARCH_STOP_WORDS = new Set([
  "about",
  "from",
  "have",
  "what",
  "when",
  "where",
  "with",
  "\u0623\u064a\u0646",
  "\u0627\u0644\u0649",
  "\u0625\u0644\u0649",
  "\u0627\u0648",
  "\u0623\u0648",
  "\u0641\u064a",
  "\u0643\u0645",
  "\u0643\u064a\u0641",
  "\u0645\u0627",
  "\u0645\u0627\u0630\u0627",
  "\u0645\u0646",
  "\u0647\u0644",
])

/**
 * Vertex similarity alone can rank a broad Arabic paragraph above the exact
 * answer (notably short questions such as "how much is the subscription?").
 * Keep semantic retrieval as the fallback, but let meaningful literal terms
 * rescue and promote an exact knowledge-base passage below the vector cutoff.
 */
export function rankSearchResults(
  query: string,
  results: SimilaritySearchResult[],
  config: Pick<FileSearchConfig, "maxResults" | "similarityThreshold">,
): SimilaritySearchResult[] {
  const queryTerms = getSearchTerms(query)

  return results
    .map((result, originalIndex) => {
      const normalizedContent = normalizeSearchText(result.content)
      const lexicalHits = queryTerms.filter((term) =>
        normalizedContent.includes(term),
      ).length
      const lexicalOccurrences = queryTerms.reduce(
        (count, term) => count + countOccurrences(normalizedContent, term),
        0,
      )

      return { lexicalHits, lexicalOccurrences, originalIndex, result }
    })
    .filter(
      ({ lexicalHits, result }) =>
        result.distance > config.similarityThreshold || lexicalHits > 0,
    )
    .sort(
      (a, b) =>
        b.lexicalHits - a.lexicalHits ||
        b.lexicalOccurrences - a.lexicalOccurrences ||
        b.result.distance - a.result.distance ||
        a.originalIndex - b.originalIndex,
    )
    .slice(0, config.maxResults)
    .map(({ result }) => result)
}

function getSearchTerms(value: string): string[] {
  return Array.from(
    new Set(
      normalizeSearchText(value)
        .split(" ")
        .map((term) => term.replace(ARABIC_DEFINITE_ARTICLE, ""))
        .filter((term) => term.length >= 3 && !SEARCH_STOP_WORDS.has(term)),
    ),
  )
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(ARABIC_DIACRITICS, "")
    .toLocaleLowerCase("ar")
    .replace(NON_ALPHANUMERIC, " ")
    .trim()
}

function countOccurrences(value: string, term: string): number {
  let count = 0
  let offset = value.indexOf(term)
  while (offset !== -1) {
    count += 1
    offset += term.length
    offset = value.indexOf(term, offset)
  }
  return count
}
