// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
  isWithinAttachmentLimit,
  isWithinServerAttachmentLimit,
  MAX_BRIDGE_ATTACHMENT_MB,
  maxAttachmentMb,
} from "@/features/messages/lib/attachment-limits"

const MB = 1000 * 1000

describe("inbox attachment limits", () => {
  test("images stay capped at 5MB", () => {
    expect(maxAttachmentMb("image/jpeg")).toBe(5)
    expect(isWithinAttachmentLimit({ type: "image/png", size: 5 * MB })).toBe(
      true,
    )
    expect(
      isWithinAttachmentLimit({ type: "image/png", size: 5 * MB + 1 }),
    ).toBe(false)
  })

  test("video, audio and documents go up to 16MB", () => {
    for (const type of ["video/mp4", "audio/ogg", "application/pdf", ""]) {
      expect(maxAttachmentMb(type)).toBe(16)
      expect(isWithinAttachmentLimit({ type, size: 12 * MB })).toBe(true)
      expect(isWithinAttachmentLimit({ type, size: 16 * MB + 1 })).toBe(false)
    }
  })

  test("WhatsApp Web workspaces take a 3-4 minute video up to 100MB", () => {
    const video = (size: number) => ({ type: "video/mp4", size })
    expect(
      isWithinAttachmentLimit(video(90 * MB), MAX_BRIDGE_ATTACHMENT_MB),
    ).toBe(true)
    expect(
      isWithinAttachmentLimit(video(100 * MB + 1), MAX_BRIDGE_ATTACHMENT_MB),
    ).toBe(false)
    expect(isWithinServerAttachmentLimit(video(100 * MB))).toBe(true)
    expect(isWithinServerAttachmentLimit(video(100 * MB + 1))).toBe(false)
    // Images keep WhatsApp's own 5MB cap everywhere.
    expect(
      isWithinAttachmentLimit(
        { type: "image/jpeg", size: 6 * MB },
        MAX_BRIDGE_ATTACHMENT_MB,
      ),
    ).toBe(false)
  })
})
