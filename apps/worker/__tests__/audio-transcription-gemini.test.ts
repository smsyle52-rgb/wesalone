import { beforeEach, describe, expect, it, vi } from "vitest"

const chatTranscribe = vi.fn()
const sttTranscribe = vi.fn()

vi.mock("@chatbotx.io/ai/server", () => ({
  getPlatformAzureFoundryChatConfig: () => ({ model: "gemini-3.8-flash-high" }),
  getPlatformTranscriptionModel: async () => ({
    model: {},
    modelId: "gpt-4o-transcribe",
    region: "x",
  }),
  transcribeWithPlatformChatModel: (...args: unknown[]) =>
    chatTranscribe(...args),
}))
vi.mock("ai", () => ({
  experimental_transcribe: (...args: unknown[]) => sttTranscribe(...args),
}))
vi.mock("@chatbotx.io/business", () => ({
  usageMeteringService: {
    reserve: vi.fn(async () => ({ id: "r" })),
    settleUnits: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  },
}))
vi.mock("@chatbotx.io/filesystem", () => ({
  uploader: { getObject: vi.fn(async () => new Uint8Array(4000).buffer) },
}))
vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { transcribeAudioAttachments } from "../src/integration/handlers/automated-response/audio-transcription"

const voiceNote = {
  id: "a1",
  fileType: "audio",
  mimeType: "audio/ogg; codecs=opus",
  size: 4000,
  originPath: "public/x.ogg",
} as never

const run = () =>
  transcribeAudioAttachments({
    attachments: [voiceNote],
    conversationId: "c1",
    workspaceId: "w1",
  })

describe("voice-note transcription", () => {
  beforeEach(() => {
    chatTranscribe.mockReset()
    sttTranscribe.mockReset()
  })

  it("uses the chat model (Gemini) first", async () => {
    chatTranscribe.mockResolvedValue({
      text: "وإذا ما نفعش معي، أتردوا لي الزلط؟",
      modelId: "gemini-3.8-flash-high",
    })
    expect(await run()).toEqual(["وإذا ما نفعش معي، أتردوا لي الزلط؟"])
    expect(sttTranscribe).not.toHaveBeenCalled()
  })

  it("falls back to speech-to-text when the chat model fails", async () => {
    chatTranscribe.mockRejectedValue(new Error("HTTP 500"))
    sttTranscribe.mockResolvedValue({
      text: "نص احتياطي",
      durationInSeconds: 3,
    })
    expect(await run()).toEqual(["نص احتياطي"])
  })
})
