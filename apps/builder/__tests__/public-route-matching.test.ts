// @vitest-environment node

import { describe, expect, test, vi } from "vitest"

// proxy.ts pulls in auth/logging at module scope; neither is needed to exercise
// the pure path matcher.
vi.mock("@/lib/auth/auth", () => ({ auth: {} }))
vi.mock("../src/lib/log", () => ({
  httpLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const { isPublicRoute } = await import("../src/proxy")

describe("isPublicRoute", () => {
  test("allows the routes that must be reachable signed out", () => {
    for (const pathname of [
      "/",
      "/pricing",
      "/about",
      "/auth/sign-in",
      "/auth/sign-up",
      "/api/health",
      "/integrations/whatsapp/callback",
      "/channels/create",
      "/r/123/my-link",
      "/l/123/456",
      "/data-deletion",
    ]) {
      expect(isPublicRoute(pathname), pathname).toBe(true)
    }
  })

  test("does not let a short-link prefix open every path starting with that letter", () => {
    // "/r" and "/l" are short-link roots. A bare startsWith() matched these
    // too, so they reached the app with no auth check — harmless only because
    // no such page exists yet.
    for (const pathname of [
      "/register",
      "/login",
      "/reports",
      "/leads",
      "/rules",
      "/logs",
    ]) {
      expect(isPublicRoute(pathname), pathname).toBe(false)
    }
  })

  test("does not match a public prefix that is only part of a longer segment", () => {
    for (const pathname of [
      "/apixyz",
      "/authorize",
      "/pricingplans",
      "/aboutus",
      "/channelsettings",
    ]) {
      expect(isPublicRoute(pathname), pathname).toBe(false)
    }
  })

  test("keeps workspace paths private", () => {
    for (const pathname of [
      "/space/123/settings/channels",
      "/admin/platform-credentials",
      "/manage/help-items",
    ]) {
      expect(isPublicRoute(pathname), pathname).toBe(false)
    }
  })
})
