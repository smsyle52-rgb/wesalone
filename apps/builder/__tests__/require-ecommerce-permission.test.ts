// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const { mockFindMembership } = vi.hoisted(() => ({
  mockFindMembership: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  workspaceMemberService: { findMembership: mockFindMembership },
}))

const { requireEcommercePermission } = await import(
  "../src/features/orders/api/require-ecommerce-permission"
)

const basePermissions = {
  superAdmin: false,
  analytics: false,
  flows: false,
  contacts: false,
  onlyAssignedContacts: false,
  emailAndPhone: false,
  broadcast: false,
  ecommerce: false,
}

describe("requireEcommercePermission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("resolves when the member has the ecommerce permission", async () => {
    mockFindMembership.mockResolvedValueOnce({
      permissions: { ...basePermissions, ecommerce: true },
    })

    await expect(
      requireEcommercePermission({ workspaceId: "ws-1", userId: "user-1" }),
    ).resolves.toBeUndefined()
  })

  test("resolves for a superAdmin even without the explicit ecommerce flag", async () => {
    mockFindMembership.mockResolvedValueOnce({
      permissions: { ...basePermissions, superAdmin: true },
    })

    await expect(
      requireEcommercePermission({ workspaceId: "ws-1", userId: "user-1" }),
    ).resolves.toBeUndefined()
  })

  test("rejects with FORBIDDEN when the member lacks the ecommerce permission", async () => {
    mockFindMembership.mockResolvedValueOnce({
      permissions: basePermissions,
    })

    await expect(
      requireEcommercePermission({ workspaceId: "ws-1", userId: "user-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  test("rejects with FORBIDDEN when the caller is not a member of the workspace at all", async () => {
    mockFindMembership.mockResolvedValueOnce(undefined)

    await expect(
      requireEcommercePermission({ workspaceId: "ws-1", userId: "user-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
})
