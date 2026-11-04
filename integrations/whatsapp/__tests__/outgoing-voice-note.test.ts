import { beforeEach, describe, expect, test, vi } from "vitest"

const { mockSendMessage, mockGetWhatsappClient } = vi.hoisted(() => {
  const sendMessageFn = vi.fn()
  return {
    mockSendMessage: sendMessageFn,
    mockGetWhatsappClient: vi.fn(() => ({ sendMessage: sendMessageFn })),
  }
})

vi.mock("../src/client", () => ({
  getWhatsappClient: mockGetWhatsappClient,
}))

vi.mock("../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { sendMessage, isWhatsappVoiceNoteMimeType } = await import(
  "../src/handlers/message/outgoing-message"
)

const ctx = {
  auth: { metadata: { phoneNumber: { id: "pn-1" } } },
  integrationDetail: { registrationStatus: "registered" },
} as never
const contact = { id: "contact-1", sourceId: "967700000000" } as never

const sendAudio = (mimeType: string, url: string) =>
  sendMessage({
    ctx,
    data: {
      contact,
      message: {
        id: "msg-1",
        contentType: "text",
        text: "",
        attachments: [{ fileType: "audio", mimeType, url }],
      },
    },
  } as never)

describe("isWhatsappVoiceNoteMimeType", () => {
  test("accepts Ogg/Opus with or without codec parameters", () => {
    expect(isWhatsappVoiceNoteMimeType("audio/ogg")).toBe(true)
    expect(isWhatsappVoiceNoteMimeType("audio/ogg; codecs=opus")).toBe(true)
    expect(isWhatsappVoiceNoteMimeType("AUDIO/OGG")).toBe(true)
    expect(isWhatsappVoiceNoteMimeType("audio/opus")).toBe(true)
  })

  test("rejects other audio formats and missing values", () => {
    expect(isWhatsappVoiceNoteMimeType("audio/mpeg")).toBe(false)
    expect(isWhatsappVoiceNoteMimeType("audio/mp4")).toBe(false)
    expect(isWhatsappVoiceNoteMimeType("audio/webm")).toBe(false)
    expect(isWhatsappVoiceNoteMimeType(null)).toBe(false)
    expect(isWhatsappVoiceNoteMimeType(undefined)).toBe(false)
  })
})

describe("whatsapp sendMessage audio attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.voice-1" }],
    })
  })

  test("sends an Ogg/Opus recording as a voice note", async () => {
    await sendAudio("audio/ogg", "https://cdn.example/voice.ogg")

    const [, , payload] = mockSendMessage.mock.calls[0] ?? []
    expect(payload).toMatchObject({
      _type: "audio",
      link: "https://cdn.example/voice.ogg",
      voice: true,
    })
  })

  test("sends other audio as a regular audio file", async () => {
    await sendAudio("audio/mpeg", "https://cdn.example/song.mp3")

    const [, , payload] = mockSendMessage.mock.calls[0] ?? []
    expect(payload).toMatchObject({
      _type: "audio",
      link: "https://cdn.example/song.mp3",
    })
    expect(payload.voice).toBeFalsy()
  })
})
