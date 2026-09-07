import { describe, expect, test } from "vitest"
import {
  defaultMimeTypeForFileType,
  guessFileTypeFromMimeType,
  resolveIncomingFileType,
} from "../src/lib/util"

/**
 * Instagram, Messenger and Zalo type an inbound attachment from the
 * `content-type` of its CDN download. Meta serves voice clips as
 * `application/octet-stream`, so every one of them was stored as `file` — and
 * the automated-response handler only transcribes an attachment whose
 * `fileType` is `audio`. Production on 8 Sep 2026: 178 Instagram attachments
 * as `file`/octet-stream over seven days, zero as `audio`, against 4,789
 * correctly typed WhatsApp voice notes.
 */
describe("resolveIncomingFileType", () => {
  test("a Meta voice clip served as octet-stream is audio, not file", () => {
    expect(guessFileTypeFromMimeType("application/octet-stream")).toBe("file")
    expect(resolveIncomingFileType("application/octet-stream", "audio")).toBe(
      "audio",
    )
  })

  test("a real media content type still wins over the declared kind", () => {
    expect(resolveIncomingFileType("audio/ogg; codecs=opus", "file")).toBe(
      "audio",
    )
    expect(resolveIncomingFileType("image/jpeg", "file")).toBe("image")
  })

  test("reels and stickers map onto our own file types", () => {
    expect(resolveIncomingFileType("application/octet-stream", "ig_reel")).toBe(
      "video",
    )
    expect(resolveIncomingFileType("application/octet-stream", "sticker")).toBe(
      "image",
    )
  })

  test("a kind carrying no media of its own keeps the header's verdict", () => {
    expect(resolveIncomingFileType("application/pdf", "fallback")).toBe("file")
    expect(resolveIncomingFileType("application/pdf", "share")).toBe("file")
  })

  test("a missing header falls back to the declared kind", () => {
    expect(resolveIncomingFileType(null, "audio")).toBe("audio")
    expect(resolveIncomingFileType(undefined, "video")).toBe("video")
    expect(resolveIncomingFileType(null, null)).toBe("file")
  })

  test("a headerless attachment is no longer labelled image/png", () => {
    expect(defaultMimeTypeForFileType("audio")).toBe("audio/mpeg")
    expect(defaultMimeTypeForFileType("video")).toBe("video/mp4")
    expect(defaultMimeTypeForFileType("file")).toBe("application/octet-stream")
    expect(defaultMimeTypeForFileType("image")).toBe("image/png")
  })
})
