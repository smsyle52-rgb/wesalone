// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const ROOT_TENANT_ID = "1"
const SOCIAL_PROVIDERS = ["google", "facebook"] as const

const {
  mockCreateAuth,
  mockFindDecryptedPlatform,
  mockResolveForOwner,
  mockResolveTenantByDomain,
  mockResolveTenantOwnerId,
} = vi.hoisted(() => ({
  mockCreateAuth: vi.fn(
    (config: {
      socialCredentials?: Record<string, { clientId: string } | null>
    }) => {
      const [provider, credential] = Object.entries(
        config.socialCredentials ?? {},
      )[0] ?? [null, null]
      return { provider, clientId: credential?.clientId ?? null }
    },
  ),
  mockFindDecryptedPlatform: vi.fn(),
  mockResolveForOwner: vi.fn(),
  mockResolveTenantByDomain: vi.fn(),
  mockResolveTenantOwnerId: vi.fn(),
}))

vi.mock("@chatbotx.io/auth/server", () => ({
  createAuth: mockCreateAuth,
  SOCIAL_PROVIDERS,
}))

vi.mock("@chatbotx.io/auth/tenant", () => ({
  resolveTenantByDomain: mockResolveTenantByDomain,
  resolveTenantOwnerId: mockResolveTenantOwnerId,
}))

vi.mock("@/lib/auth/on-user-created", () => ({
  onUserCreated: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  platformCredentialService: {
    findDecryptedPlatform: mockFindDecryptedPlatform,
    resolveForOwner: mockResolveForOwner,
  },
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  ROOT_TENANT_ID,
}))

vi.mock("@/lib/auth/upgrade-facebook-account", () => ({
  FACEBOOK_SSO_SCOPES: ["email", "public_profile"],
  upgradeFacebookAccount: vi.fn(() => vi.fn()),
}))

vi.mock("@/env", () => ({
  isCommunity: vi.fn(() => true),
  isCloud: vi.fn(() => false),
  env: { NEXT_PUBLIC_BUILDER_URL: "https://app.example.com" },
}))

const credential = (clientId: string) => ({
  config: { clientId, clientSecret: "secret", verifyToken: "t", version: "v1" },
})

async function loadModule() {
  vi.resetModules()
  return await import("@/lib/auth/auth-instances")
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Upstream asserts the opposite of every case here: on the community edition it
 * refuses social login outright, before even looking a credential up, because
 * upstream treats it as a paid-tier feature.
 *
 * Wesal One deliberately removed that gate. It runs with
 * NEXT_PUBLIC_EDITION=community — switching to cloud/enterprise makes both apps
 * refuse to start without a LICENSE_KEY — while holding a real platform Google
 * credential, so upstream's gate discarded a working sign-in method for a reason
 * unrelated to this platform's licence state. See `resolveCredentialForTenant`.
 *
 * The suite is kept rather than deleted, with its expectations inverted, so the
 * behaviour stays pinned in both directions: an upstream merge that restores the
 * gate fails here, and a change that starts leaking credentials when none are
 * configured fails here too.
 */
describe("social login follows the configured credential, not the edition", () => {
  test("social login is enabled when a platform credential exists", async () => {
    mockFindDecryptedPlatform.mockResolvedValue(credential("platform-client"))
    const { isSocialLoginEnabledForTenant } = await loadModule()

    expect(await isSocialLoginEnabledForTenant(ROOT_TENANT_ID, "google")).toBe(
      true,
    )
    // The gate used to return before this lookup ever ran.
    expect(mockFindDecryptedPlatform).toHaveBeenCalled()
  })

  test("the auth instance carries the configured client id", async () => {
    mockFindDecryptedPlatform.mockResolvedValue(credential("platform-client"))
    const { getSocialAuthForTenant } = await loadModule()

    const auth = (await getSocialAuthForTenant(
      ROOT_TENANT_ID,
      "google",
    )) as unknown as { clientId: string | null }

    expect(auth.clientId).toBe("platform-client")
  })

  test("a reseller tenant resolves its own credential", async () => {
    mockResolveTenantOwnerId.mockResolvedValue("owner-1")
    mockResolveForOwner.mockResolvedValue(credential("reseller-client"))
    const { isSocialLoginEnabledForTenant } = await loadModule()

    expect(await isSocialLoginEnabledForTenant("42", "facebook")).toBe(true)
    expect(mockResolveForOwner).toHaveBeenCalled()
  })

  test("social login stays off when no credential is configured", async () => {
    // This is what upstream's gate was standing in for, and it still holds:
    // removing the edition check did not make social login unconditionally on.
    mockFindDecryptedPlatform.mockResolvedValue(null)
    const { isSocialLoginEnabledForTenant } = await loadModule()

    expect(await isSocialLoginEnabledForTenant(ROOT_TENANT_ID, "google")).toBe(
      false,
    )
  })
})
