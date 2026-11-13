import { beforeEach, describe, expect, test, vi } from "vitest"

const { synth, eleven, reserve, release, settleUnits, saveAudio, send } =
  vi.hoisted(() => ({
    synth: vi.fn(),
    eleven: vi.fn(),
    reserve: vi.fn(),
    release: vi.fn(),
    settleUnits: vi.fn(),
    saveAudio: vi.fn(),
    send: vi.fn(),
  }))

vi.mock("@chatbotx.io/ai/server", () => ({
  synthesizePlatformSpeech: synth,
  synthesizeElevenLabsSpeech: eleven,
}))
vi.mock("@chatbotx.io/business", () => ({
  usageMeteringService: { reserve, release, settleUnits },
}))
vi.mock("../src/integration/handlers/text-to-speech/storage", () => ({
  textToSpeechStorageService: { saveAudio },
}))
vi.mock("../src/integration/utils/message", () => ({
  sendMessageAndWait: send,
}))
vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const { sendVoiceReply } = await import(
  "../src/integration/handlers/automated-response/voice-reply"
)

const conversation = { id: "c1", workspaceId: "w1" }
const base = {
  conversation,
  operationKey: "m1",
  takeTrackingContext: () => undefined,
}

describe("sendVoiceReply", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reserve.mockResolvedValue({ enabled: true, operationId: "op" })
    synth.mockResolvedValue({
      audio: new Uint8Array([1]),
      mediaType: "audio/ogg",
    })
    saveAudio.mockResolvedValue({
      publicUrl: "https://cdn/x.ogg",
      storagePath: "public/x.ogg",
    })
  })

  test("sends the spoken part as an Ogg voice note, then numbers as text", async () => {
    const ok = await sendVoiceReply({
      ...base,
      text: "أبشر يا غالي، حوّل على الكريمي\n3061241212",
      voice: "ar-XA-Chirp3-HD-Charon",
    })
    expect(ok).toBe(true)
    expect(synth).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "أبشر يا غالي، حوّل على الكريمي",
        encoding: "OGG_OPUS",
        voice: "ar-XA-Chirp3-HD-Charon",
      }),
    )
    expect(send).toHaveBeenNthCalledWith(
      1,
      "c1",
      "https://cdn/x.ogg",
      undefined,
      {
        forceUrl: true,
        storagePath: "public/x.ogg",
      },
    )
    expect(send).toHaveBeenNthCalledWith(2, "c1", "3061241212")
  })

  test("sends nothing and returns false when speech fails", async () => {
    synth.mockRejectedValue(new Error("tts down"))
    expect(await sendVoiceReply({ ...base, text: "أهلاً" })).toBe(false)
    expect(release).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test("returns false when platform speech is not configured", async () => {
    synth.mockResolvedValue(null)
    expect(await sendVoiceReply({ ...base, text: "أهلاً" })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  test("returns false when there is nothing to speak", async () => {
    expect(await sendVoiceReply({ ...base, text: "3061241212" })).toBe(false)
    expect(synth).not.toHaveBeenCalled()
  })

  test("speaks with the cloned ElevenLabs voice when one is set", async () => {
    eleven.mockResolvedValue({
      audio: new Uint8Array([2]),
      mediaType: "audio/ogg",
    })
    const ok = await sendVoiceReply({
      ...base,
      text: "أبشر يا غالي",
      elevenLabsVoiceId: "v1",
    })
    expect(ok).toBe(true)
    expect(eleven).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: "v1" }),
    )
    expect(synth).not.toHaveBeenCalled()
  })

  test("sends text, not the platform voice, when ElevenLabs fails", async () => {
    eleven.mockRejectedValue(new Error("quota_exceeded"))
    const ok = await sendVoiceReply({
      ...base,
      text: "أبشر يا غالي",
      elevenLabsVoiceId: "v1",
    })
    expect(ok).toBe(false)
    expect(synth).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test("sends text when ElevenLabs returns no audio", async () => {
    eleven.mockResolvedValue(null)
    const ok = await sendVoiceReply({
      ...base,
      text: "أبشر يا غالي",
      elevenLabsVoiceId: "v1",
    })
    expect(ok).toBe(false)
    expect(synth).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
