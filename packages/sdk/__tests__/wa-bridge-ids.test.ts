import { describe, expect, it } from "vitest"
import { toWaBridgeSourceId, wamidKeyId } from "../src/lib/shared/wa-bridge"

// Real pair from production (chat ids masked): the bridge send and its
// coexistence echo carry the same WhatsApp key id.
const KEY = "3EB01B7DF4FCEFDD3175FD"
const WAMID_BSUID =
  "wamid.HBgTWUUuMTUxMTg3OTQxNzMyOTc5OBUUABEYFjNFQjAxQjdERjRGQ0VGREQzMTc1RkQA"
const wamidPhone = `wamid.${Buffer.from(
  `\x1c\x18\x0c967700000000\x15\x02\x00\x11\x18\x16${KEY}\x00`,
  "latin1",
).toString("base64")}`

describe("WhatsApp Web bridge ids", () => {
  it("turns a whatsapp-web.js id into wab.<key id>", () => {
    expect(toWaBridgeSourceId(`true_26709170100000@lid_${KEY}`)).toBe(
      `wab.${KEY}`,
    )
    expect(toWaBridgeSourceId(`true_967700000000@c.us_${KEY}`)).toBe(
      `wab.${KEY}`,
    )
  })

  it("leaves an unknown id unchanged", () => {
    expect(toWaBridgeSourceId("something-else")).toBe("something-else")
  })

  it("reads the key id out of a wamid (BSUID and phone chats)", () => {
    expect(wamidKeyId(WAMID_BSUID)).toBe(KEY)
    expect(wamidKeyId(wamidPhone)).toBe(KEY)
  })

  it("returns null for a non-wamid", () => {
    expect(wamidKeyId(`wab.${KEY}`)).toBeNull()
    expect(wamidKeyId("wamid.")).toBeNull()
  })
})
