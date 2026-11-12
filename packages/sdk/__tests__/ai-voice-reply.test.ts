import { describe, expect, it } from "vitest"
import {
  getAiVoiceReplyConfig,
  splitVoiceReply,
  takeVoiceChoice,
} from "../src/lib/shared/ai-voice-reply"

describe("splitVoiceReply", () => {
  it("speaks the conversation and keeps account and phone numbers as text", () => {
    const reply =
      "أبشر يا غالي، الكيس باثنعش ألف وخمسمية والتوصيل علينا.\nالكريمي: 3061241212\nجيب: 775 845 806"
    expect(splitVoiceReply(reply)).toEqual({
      spoken: "أبشر يا غالي، الكيس باثنعش ألف وخمسمية والتوصيل علينا.",
      textOnly: "الكريمي: 3061241212\nجيب: 775 845 806",
    })
  })

  it("keeps short numbers like a price in the spoken part", () => {
    expect(splitVoiceReply("السعر 12,500 ريال").spoken).toBe(
      "السعر 12,500 ريال",
    )
  })

  it("returns nothing to speak when the reply is only numbers", () => {
    expect(splitVoiceReply("3061241212").spoken).toBe("")
  })
})

describe("getAiVoiceReplyConfig", () => {
  it("is on for listed workspaces only", () => {
    expect(getAiVoiceReplyConfig("11767468508764852")).not.toBeNull()
    expect(getAiVoiceReplyConfig("1")).toBeNull()
    expect(getAiVoiceReplyConfig(null)).toBeNull()
  })

  it("takes a workspace's voice from the server setting when set", () => {
    const saba = "11767468508764852"
    const overrides = JSON.stringify({ [saba]: "voice-from-env", "1": "x" })
    expect(getAiVoiceReplyConfig(saba, overrides)?.elevenLabsVoiceId).toBe(
      "voice-from-env",
    )
    // The setting never turns voice replies on for an unlisted workspace.
    expect(getAiVoiceReplyConfig("1", overrides)).toBeNull()
    // A malformed setting keeps the built-in voice.
    expect(getAiVoiceReplyConfig(saba, "{oops")?.elevenLabsVoiceId).toBe(
      getAiVoiceReplyConfig(saba)?.elevenLabsVoiceId,
    )
  })
})

describe("takeVoiceChoice", () => {
  it("reads a reply the agent chose to speak", () => {
    expect(takeVoiceChoice("[صوت]\nأرحب يا محمد، معك ملاك")).toEqual({
      voice: true,
      text: "أرحب يا محمد، معك ملاك",
    })
  })

  it("keeps an unmarked reply as text", () => {
    expect(takeVoiceChoice("الكيس بـ 12,500 ريال")).toEqual({
      voice: false,
      text: "الكيس بـ 12,500 ريال",
    })
  })

  it("drops a stray marker inside a text reply", () => {
    expect(takeVoiceChoice("تمام [صوت] نحجز لك").text).toBe("تمام  نحجز لك")
  })

  it("lets the Saba workspace mix voice and text", () => {
    expect(getAiVoiceReplyConfig("11767468508764852")?.mixed).toBe(true)
  })
})
