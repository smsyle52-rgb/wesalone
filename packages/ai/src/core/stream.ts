import {
  supportedAudioExtensions,
  supportedFileExtensions,
  supportedImageExtensions,
  supportedVideoExtensions,
} from "../schemas"

const REGEX_ANY_TOKEN =
  /!\[[^\]]*\]\(\s*([^)\s\r\n]+)\s*\)|\[[^\]]+\]\(\s*([^)\s\r\n]+)\s*\)|(https?:\/\/[^\s)\]]+(?:\?[^\s)\]]*)?)/g
const REGEX_ONLY_WHITESPACE = /^\s*$/
const REGEX_ONLY_EMOJI = /^[\u{1F300}-\u{1F9FF}]+$/u
const REGEX_STARS_OR_DASHES = /^[-*]\s*/u
const REGEX_NOISY_CHARS = /^[-*.\s]+$/
const REGEX_BOLD_MARKDOWN = /(\*\*|__)([^*_]+?)\1/g
const REGEX_ITALIC_MARKDOWN = /(\*|_)([^*_]+?)\1/g
const PARAGRAPH_SEPARATOR = "\n\n"

// --- Wesal: Arabic reply fixes, all behind one switch -----------------------
//
// Set WESAL_REPLY_FIXES=off to restore upstream ChatbotX behaviour exactly,
// with no rebuild:
//   az containerapp update --set-env-vars WESAL_REPLY_FIXES=off
// Default is on. Each fix only ever changes Arabic output.
export function wesalReplyFixesEnabled(): boolean {
  return process.env.WESAL_REPLY_FIXES !== "off"
}

// Upstream's URL pattern above stops only at whitespace. English words are
// space-separated so a link is never touched; Arabic butts straight against it
// and the following word is swallowed into the href. On 27 Aug a customer was
// sent `...byhandsتقدر` — a Play Store link that does not open. Arabic letters
// and emoji cannot appear in a URL, so excluding them cannot break a valid one.
const REGEX_ANY_TOKEN_AR =
  /!\[[^\]]*\]\(\s*([^)\s\r\n]+)\s*\)|\[[^\]]+\]\(\s*([^)\s\r\n]+)\s*\)|(https?:\/\/[^\s)\]؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\u{1F300}-\u{1F9FF}]+(?:\?[^\s)\]؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\u{1F300}-\u{1F9FF}]*)?)/gu

// The reply loop runs up to five steps (`stepCountIs(5)` in replies.ts — that
// is upstream's own value). `textStream` carries the text of EVERY step, so a
// model that answers, calls the knowledge tool, then answers again has BOTH
// answers sent to the customer. Nothing marks a step boundary in the stream,
// which is why the second copy arrives welded onto the tail of the first with
// no blank line — and therefore never matches a whole part. What was already
// sent has to be cut out from inside the next part.
const MIN_DEDUPE_LENGTH = 12
const NEAR_DUPLICATE_RATIO = 0.8
const REGEX_ALL_WHITESPACE = /\s+/g

function dedupeKey(part: string): string {
  return part.replace(REGEX_ALL_WHITESPACE, "").toLowerCase()
}

function withoutAlreadySent(part: string, sent: string[]): string {
  let out = part
  let changed = false
  for (const seen of sent) {
    if (seen.length < MIN_DEDUPE_LENGTH) {
      continue
    }
    if (out.includes(seen)) {
      out = out.split(seen).join(" ")
      changed = true
    }
  }
  // Only normalize whitespace when something was actually removed, so a part
  // that was never touched keeps its own line breaks exactly as upstream sends
  // them.
  return changed ? out.replace(REGEX_ALL_WHITESPACE, " ").trim() : out
}

// TEMPORARY LOCAL PATCH — remove once upstream stops streaming every step's
// text (ChatbotX issue: reply text duplicated inside a single message).
//
// `withoutAlreadySent` above can only cut text that was already *sent*. When
// the model repeats its whole answer inside one segment — no blank line, so it
// never splits into two parts — nothing has been sent yet and the doubled text
// passes straight through. Measured on production 31 Aug 2026: 22 of 420 bot
// messages in 24h, e.g. "…كم الكمية؟أهلاً بك، فول الثريا متوفر…".
//
// Deliberately narrow: the head is dropped only when it is *exactly* the tail
// after whitespace normalization, so a reply that legitimately repeats a
// phrase (a product list, a confirmed quantity) is never truncated.
const SELF_REPEAT_PROBE_LENGTH = 30

function withoutSelfRepeat(part: string): string {
  const text = part.trim()
  if (text.length < MIN_DEDUPE_LENGTH * 2) {
    return part
  }

  const probe = text.slice(0, SELF_REPEAT_PROBE_LENGTH)
  if (probe.trim().length < MIN_DEDUPE_LENGTH) {
    return part
  }

  let searchFrom = SELF_REPEAT_PROBE_LENGTH
  while (searchFrom < text.length) {
    const at = text.indexOf(probe, searchFrom)
    if (at === -1) {
      return part
    }
    const head = text.slice(0, at)
    const tail = text.slice(at)
    if (dedupeKey(head) === dedupeKey(tail)) {
      return head.trim()
    }
    searchFrom = at + 1
  }

  return part
}

function isRepeatOfSent(key: string, sent: Set<string>): boolean {
  // Short confirmations (a price, a phone number, "تمام") may legitimately
  // repeat inside one reply.
  if (key.length < MIN_DEDUPE_LENGTH) {
    return false
  }
  for (const seen of sent) {
    if (seen === key) {
      return true
    }
    if (
      seen.includes(key) ||
      (key.includes(seen) && seen.length / key.length > NEAR_DUPLICATE_RATIO)
    ) {
      return true
    }
  }
  return false
}

type StreamProcessingOptions = {
  sendParts?: boolean
  trackingContext?: unknown
}

function isMeaningfulPart(part: string): boolean {
  if (!part) {
    return false
  }
  if (REGEX_ONLY_WHITESPACE.test(part)) {
    return false
  }
  if (REGEX_ONLY_EMOJI.test(part)) {
    return false
  }
  if (REGEX_NOISY_CHARS.test(part)) {
    return false
  }
  return true
}

function getMeaningfulParts(parts: string[]): string[] {
  const normalized: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!isMeaningfulPart(trimmed)) {
      continue
    }
    normalized.push(trimmed)
  }
  return normalized
}

const REGEX_TRAILING_LIST_MARKER = /\n\s*[-*]\s*$/

function cleanText(value: string): string {
  return String(value ?? "")
    .replace(REGEX_BOLD_MARKDOWN, "$2")
    .replace(REGEX_ITALIC_MARKDOWN, "$2")
    .replace(REGEX_STARS_OR_DASHES, "")
    .trim()
    .replace(REGEX_TRAILING_LIST_MARKER, "")
    .trim()
}

function isMediaUrl(url: string, extensions: string[]): boolean {
  const s = url.trim().toLowerCase()
  if (!(s.startsWith("http://") || s.startsWith("https://"))) {
    return false
  }
  try {
    const u = new URL(s)
    const p = u.pathname.toLowerCase()
    return extensions.some((ext) => p.endsWith(ext))
  } catch {
    return false
  }
}

export function isImageUrl(url: string): boolean {
  return isMediaUrl(
    url,
    supportedImageExtensions.options.map((ext) => `.${ext}`),
  )
}

export function isAudioUrl(url: string): boolean {
  return isMediaUrl(url, supportedAudioExtensions.options)
}

export function isVideoUrl(url: string): boolean {
  return isMediaUrl(url, supportedVideoExtensions.options)
}

export function isFileUrl(url: string): boolean {
  return isMediaUrl(url, supportedFileExtensions.options)
}

export function processTextForImagesAndLinks(text: string): string[] {
  if (!text) {
    return []
  }

  const parts: string[] = []
  const seenUrls = new Set<string>()
  const token = wesalReplyFixesEnabled() ? REGEX_ANY_TOKEN_AR : REGEX_ANY_TOKEN
  const tokenRegex = new RegExp(token.source, token.flags)
  let cursor = 0

  for (const match of text.matchAll(tokenRegex)) {
    const start = match.index ?? 0
    const token = match[0] ?? ""

    if (start > cursor) {
      const before = cleanText(text.slice(cursor, start))
      if (before) {
        parts.push(before)
      }
    }

    const url = (match[1] || match[2] || match[3] || "").trim()
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url)
      parts.push(url)
    }

    cursor = start + token.length
  }

  if (cursor < text.length) {
    const tail = cleanText(text.slice(cursor))
    if (tail) {
      parts.push(tail)
    }
  }

  return getMeaningfulParts(parts)
}

export async function processStreamingText(
  textStream: AsyncIterable<string>,
  onSegment: (segment: string, parts: string[]) => Promise<void>,
  options?: StreamProcessingOptions,
): Promise<{ messageCount: number; fullText: string }> {
  let fullText = ""
  let messageCount = 0
  const sendParts = options?.sendParts !== false
  let currentSegment = ""
  const dedupe = wesalReplyFixesEnabled()
  const sentKeys = new Set<string>()
  const sentParts: string[] = []

  const handleSegment = async (segment: string) => {
    const allParts = processTextForImagesAndLinks(segment)
    // Nothing has been sent yet when the first part arrives, so it always
    // passes through untouched: a reply can never be emptied into the
    // "no text produced" fallback.
    const parts = dedupe
      ? allParts.flatMap((part) => {
          const remainder = withoutAlreadySent(
            withoutSelfRepeat(part),
            sentParts,
          )
          if (!remainder) {
            return []
          }
          const key = dedupeKey(remainder)
          if (isRepeatOfSent(key, sentKeys)) {
            return []
          }
          sentParts.push(remainder)
          sentKeys.add(key)
          return [remainder]
        })
      : allParts
    if (parts.length === 0) {
      return
    }
    if (sendParts) {
      await onSegment(segment, parts)
      messageCount += parts.length
    } else {
      messageCount += parts.length
    }
  }

  for await (const delta of textStream) {
    fullText += delta
    currentSegment += delta

    let separatorIndex = currentSegment.indexOf(PARAGRAPH_SEPARATOR)
    while (separatorIndex !== -1) {
      const segment = currentSegment.slice(0, separatorIndex).trim()
      if (segment) {
        await handleSegment(segment)
      }
      currentSegment = currentSegment.slice(
        separatorIndex + PARAGRAPH_SEPARATOR.length,
      )
      separatorIndex = currentSegment.indexOf(PARAGRAPH_SEPARATOR)
    }
  }

  const tailSegment = currentSegment.trim()
  if (tailSegment) {
    await handleSegment(tailSegment)
  }

  return { messageCount, fullText }
}
