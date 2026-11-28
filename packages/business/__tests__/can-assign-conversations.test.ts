import { describe, expect, test } from "vitest"
import { canAssignConversations } from "../src/workspace-member/permissions"

describe("canAssignConversations", () => {
  test("absent flag keeps the old behaviour (allowed)", () => {
    expect(canAssignConversations({ contacts: true })).toBe(true)
    expect(canAssignConversations({})).toBe(true)
  })

  test("an explicit false hides assignment from the member", () => {
    expect(
      canAssignConversations({ contacts: true, assignConversations: false }),
    ).toBe(false)
  })

  test("a super admin may always assign", () => {
    expect(
      canAssignConversations({ superAdmin: true, assignConversations: false }),
    ).toBe(true)
  })
})
