import { describe, expect, test } from "vitest"
import {
  isAgentAllowedForContact,
  parseAgentTestContacts,
} from "../src/integration/handlers/automated-response/test-contacts"

describe("AI agent test contacts", () => {
  const raw = "111:+7 912 487-7261|967700000000, bad , 222:"

  test("parses entries and skips malformed ones", () => {
    const map = parseAgentTestContacts(raw)
    expect([...map.keys()]).toEqual(["111"])
    expect([...(map.get("111") ?? [])]).toEqual(["79124877261", "967700000000"])
  })

  test("a listed workspace answers only its test numbers", () => {
    expect(isAgentAllowedForContact("111", "79124877261", raw)).toBe(true)
    expect(isAgentAllowedForContact("111", "967711111111", raw)).toBe(false)
    expect(isAgentAllowedForContact("111", null, raw)).toBe(false)
  })

  test("other workspaces are unaffected", () => {
    expect(isAgentAllowedForContact("333", "967711111111", raw)).toBe(true)
    expect(isAgentAllowedForContact("333", null, undefined)).toBe(true)
  })
})
