import { describe, expect, it } from "vitest"
import {
  getAiVoiceReplyConfig,
  splitVoiceReply,
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
})
