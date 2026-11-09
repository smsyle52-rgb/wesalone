import { describe, expect, test } from "vitest"
import { decodeVapidKey } from "@/features/chat/hooks/use-web-push-subscription"

describe("decodeVapidKey", () => {
  test("decodes URL-safe base64 without padding", () => {
    // "\xfb\xff\xbf" is "-_-_" in URL-safe base64 ("+/+/" in standard).
    expect(Array.from(decodeVapidKey("-_-_"))).toEqual([251, 255, 191])
    expect(Array.from(decodeVapidKey("AQID"))).toEqual([1, 2, 3])
    expect(Array.from(decodeVapidKey("AQ"))).toEqual([1])
  })
})
