import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  needsVoiceNoteTranscode,
  VOICE_NOTE_SUFFIX,
  voiceNoteUrl,
  withWhatsappVoiceNotes,
} from "../src/chat/handlers/whatsapp-voice-note"

const { getObject, putObject } = vi.hoisted(() => ({
  getObject: vi.fn(),
  putObject: vi.fn(),
}))

vi.mock("@chatbotx.io/filesystem", () => ({
  uploader: { getObject, putObject },
}))

vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const path = "public/space/1/conversations/2/3"
const url = `https://bucket.s3.amazonaws.com/${path}`

describe("needsVoiceNoteTranscode", () => {
  it("transcodes Safari MP4 audio", () => {
    expect(
      needsVoiceNoteTranscode({
        fileType: "audio",
        mimeType: "audio/mp4",
        originPath: path,
        url,
      }),
    ).toBe(true)
  })

  it("leaves Ogg/Opus audio alone", () => {
    for (const mimeType of [
      "audio/ogg",
      "audio/ogg; codecs=opus",
      "audio/opus",
    ]) {
      expect(
        needsVoiceNoteTranscode({
          fileType: "audio",
          mimeType,
          originPath: path,
          url,
        }),
      ).toBe(false)
    }
  })

  it("ignores non-audio and attachments it cannot address", () => {
    expect(
      needsVoiceNoteTranscode({
        fileType: "image",
        mimeType: "image/jpeg",
        originPath: path,
        url,
      }),
    ).toBe(false)
    expect(
      needsVoiceNoteTranscode({
        fileType: "audio",
        mimeType: "audio/mp4",
        originPath: path,
        url: "https://elsewhere.example/file",
      }),
    ).toBe(false)
  })
})

describe("voiceNoteUrl", () => {
  it("points at the transcoded copy next to the original", () => {
    expect(voiceNoteUrl(url, path)).toBe(`${url}${VOICE_NOTE_SUFFIX}`)
  })
})

describe("withWhatsappVoiceNotes", () => {
  beforeEach(() => {
    getObject.mockReset()
    putObject.mockReset()
  })

  it("returns the same message when nothing needs transcoding", async () => {
    const message = {
      attachments: [
        { fileType: "audio", mimeType: "audio/ogg", url, originPath: path },
      ],
    }
    expect(await withWhatsappVoiceNotes(message)).toBe(message)
    expect(getObject).not.toHaveBeenCalled()
  })

  it("falls back to the original attachment when transcoding fails", async () => {
    getObject.mockRejectedValue(new Error("storage down"))
    const attachment = {
      fileType: "audio",
      mimeType: "audio/mp4",
      url,
      originPath: path,
    }
    const result = await withWhatsappVoiceNotes({ attachments: [attachment] })
    expect(result.attachments).toEqual([attachment])
    expect(putObject).not.toHaveBeenCalled()
  })
})
