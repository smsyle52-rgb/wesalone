import type { OutgoingContact, OutgoingMessage } from "@chatbotx.io/sdk"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { shouldUseWaBridge } from "../src/lib/wa-bridge"

const ALL_MESSAGES_WORKSPACE = "11617037734543360"
const INBOX_ONLY_WORKSPACE = "11767468508764852"
const OTHER_WORKSPACE = "1"

const contact = (lastIncomingMessageAt: Date | null) =>
  ({
    sourceId: "967781443642",
    lastIncomingMessageAt,
  }) as unknown as OutgoingContact

const message = (workspaceId: string, overrides: object = {}) =>
  ({
    id: "1",
    workspaceId,
    contentType: "text",
    text: "أهلًا وسهلًا",
    attachments: [],
    contentAttributes: {},
    ...overrides,
  }) as unknown as OutgoingMessage

describe("shouldUseWaBridge", () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.WA_BRIDGE_URL = "http://wa-bridge:8090"
    process.env.WA_BRIDGE_TOKEN = "x".repeat(32)
  })
  afterEach(() => {
    process.env = { ...env }
  })

  test("routes a bot reply inside the 24h window through the bridge for an all-messages workspace", () => {
    expect(
      shouldUseWaBridge({
        contact: contact(new Date()),
        message: message(ALL_MESSAGES_WORKSPACE),
      }),
    ).toBe(true)
  })

  test("keeps a bot reply on the Cloud API for an inbox-only bridge workspace", () => {
    expect(
      shouldUseWaBridge({
        contact: contact(new Date()),
        message: message(INBOX_ONLY_WORKSPACE),
      }),
    ).toBe(false)
  })

  test("keeps an inbox message inside the window on the Cloud API for an inbox-only bridge workspace", () => {
    expect(
      shouldUseWaBridge({
        contact: contact(new Date()),
        message: message(INBOX_ONLY_WORKSPACE),
        sendFrom: "inbox",
      }),
    ).toBe(false)
  })

  test("never uses the bridge for a workspace outside the bridge list", () => {
    expect(
      shouldUseWaBridge({
        contact: contact(null),
        message: message(OTHER_WORKSPACE),
        sendFrom: "inbox",
      }),
    ).toBe(false)
  })

  test("keeps messages the bridge cannot carry on the Cloud API", () => {
    expect(
      shouldUseWaBridge({
        contact: contact(new Date()),
        message: message(ALL_MESSAGES_WORKSPACE, {
          contentType: "location",
        }),
      }),
    ).toBe(false)
  })

  test("needs the bridge to be configured", () => {
    delete process.env.WA_BRIDGE_URL
    expect(
      shouldUseWaBridge({
        contact: contact(new Date()),
        message: message(ALL_MESSAGES_WORKSPACE),
      }),
    ).toBe(false)
  })
})
