import { describe, expect, test } from "vitest"
import {
  parseRichResponse,
  salvageRichResponseText,
} from "../src/integration/handlers/rich-response"

describe("salvageRichResponseText", () => {
  test("returns the text of a response the parser rejects as broken JSON", () => {
    const broken =
      '{"messages":[{"message":{"text":"التراسول مركب لحاله والفيناسا مركب لحاله" "x"}}]} trailing'
    const parsed = parseRichResponse(broken)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? undefined : parsed.reason).toBe("invalid_json")
    expect(salvageRichResponseText(broken)).toBe(
      "التراسول مركب لحاله والفيناسا مركب لحاله",
    )
  })

  test("keeps only complete values from a cut-off response", () => {
    const cutOff =
      '{"messages":[{"message":{"text":"مرحبا"}},{"message":{"text":"سعر العبو'
    expect(salvageRichResponseText(cutOff)).toBe("مرحبا")
  })

  test("joins several complete text values and skips duplicates", () => {
    const raw =
      '{"messages":[{"message":{"text":"أهلاً"}},{"message":{"text":"السعر 5000"}},{"message":{"text":"أهلاً"}}'
    expect(salvageRichResponseText(raw)).toBe("أهلاً\n\nالسعر 5000")
  })

  test("decodes escaped quotes and newlines", () => {
    const raw = '{"messages":[{"message":{"text":"قال \\"نعم\\"\\nتمام"}}'
    expect(salvageRichResponseText(raw)).toBe('قال "نعم"\nتمام')
  })

  test("salvages a valid response the schema rejects for being too long", () => {
    const longText = "ا".repeat(1200)
    const raw = JSON.stringify({ messages: [{ message: { text: longText } }] })
    const parsed = parseRichResponse(raw)
    expect(parsed.ok).toBe(false)
    expect(salvageRichResponseText(raw)).toBe(longText)
  })

  test("returns undefined when there is no readable text", () => {
    expect(
      salvageRichResponseText('{"messages":[{"message":{"attachment":'),
    ).toBe(undefined)
    expect(
      salvageRichResponseText('{"messages":[{"message":{"text":"  "}}'),
    ).toBe(undefined)
  })
})
