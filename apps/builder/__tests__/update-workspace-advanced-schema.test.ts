import { describe, expect, test } from "vitest"
import {
  SMART_RESPONSE_DELAY_NONE_VALUE,
  updateWorkspaceAdvancedRequest,
} from "../src/features/workspaces/schema/update-workspace-schema"

const baseInput = {
  defaultReply: "",
  targetCountry: "VN",
  language: "vi",
  timezone: "Asia/Ho_Chi_Minh",
  brandColor: "#123abc",
  developmentMode: false,
}

describe("updateWorkspaceAdvancedRequest.smartResponseDelaySeconds", () => {
  test("transforms a valid delay string into a number", () => {
    const result = updateWorkspaceAdvancedRequest.parse({
      ...baseInput,
      smartResponseDelaySeconds: "3",
    })

    expect(result.smartResponseDelaySeconds).toBe(3)
  })

  test("transforms the none value into null", () => {
    const result = updateWorkspaceAdvancedRequest.parse({
      ...baseInput,
      smartResponseDelaySeconds: SMART_RESPONSE_DELAY_NONE_VALUE,
    })

    expect(result.smartResponseDelaySeconds).toBeNull()
  })

  test("accepts its own output when parsed twice (client resolver then server inputSchema)", () => {
    const clientParsed = updateWorkspaceAdvancedRequest.parse({
      ...baseInput,
      smartResponseDelaySeconds: "3",
    })

    const serverParsed = updateWorkspaceAdvancedRequest.parse(clientParsed)

    expect(serverParsed.smartResponseDelaySeconds).toBe(3)
  })

  test("accepts null when parsed twice", () => {
    const clientParsed = updateWorkspaceAdvancedRequest.parse({
      ...baseInput,
      smartResponseDelaySeconds: SMART_RESPONSE_DELAY_NONE_VALUE,
    })

    const serverParsed = updateWorkspaceAdvancedRequest.parse(clientParsed)

    expect(serverParsed.smartResponseDelaySeconds).toBeNull()
  })

  test("rejects a delay outside the allowed options", () => {
    const result = updateWorkspaceAdvancedRequest.safeParse({
      ...baseInput,
      smartResponseDelaySeconds: "7",
import { updateWorkspaceAdvancedRequest } from "../src/features/workspaces/schema/update-workspace-schema"

const validBase = {
  defaultReply: null,
  targetCountry: "US",
  language: "en",
  timezone: "Africa/Abidjan",
  brandColor: "#016DFF",
  developmentMode: false,
}

describe("updateWorkspaceAdvancedRequest.defaultReplyFrequency", () => {
  test.each([
    "allTime",
    "oncePerHour",
    "oncePerDay",
  ] as const)("accepts '%s'", (defaultReplyFrequency) => {
    const result = updateWorkspaceAdvancedRequest.safeParse({
      ...validBase,
      defaultReplyFrequency,
    })

    expect(result.success).toBe(true)
    expect(result.data?.defaultReplyFrequency).toBe(defaultReplyFrequency)
  })

  test("rejects an invalid frequency string", () => {
    const result = updateWorkspaceAdvancedRequest.safeParse({
      ...validBase,
      defaultReplyFrequency: "everyMinute",
    })

    expect(result.success).toBe(false)
  })

  test("rejects a numeric delay outside the allowed options", () => {
    const result = updateWorkspaceAdvancedRequest.safeParse({
      ...baseInput,
      smartResponseDelaySeconds: 7,
    })

    expect(result.success).toBe(false)
  test("accepts a missing frequency (stale clients must keep the stored value untouched)", () => {
    // `validBase` itself has no `defaultReplyFrequency` key. A form rendered
    // before this field shipped submits without it; the parsed output must
    // carry `undefined` (which Drizzle's `.set()` skips) — never a concrete
    // default that would silently reset the workspace's configured frequency.
    const result = updateWorkspaceAdvancedRequest.safeParse(validBase)

    expect(result.success).toBe(true)
    expect(result.data?.defaultReplyFrequency).toBeUndefined()
  })
})
