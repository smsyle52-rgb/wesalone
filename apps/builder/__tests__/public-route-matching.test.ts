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
      // Deliberately public: both are plain redirects to the canonical
      // /auth/* routes, kept because the removed marketing template published
      // them and the links reached customers. They must NOT sit behind the
      // auth gate, or the redirect itself bounces to sign-in.
      "/login",
      "/signup",
    ]) {
      expect(isPublicRoute(pathname), pathname).toBe(true)
    }
  })

  test("does not let a short-link prefix open every path starting with that letter", () => {
    // "/r" and "/l" are short-link roots. A bare startsWith() matched these
    // too, so they reached the app with no auth check — harmless only because
    // no such page exists yet.
    //
    // "/login" is no longer listed here: it is now an explicit publicRoutes
    // entry (see the case above), so asserting it private would test the
    // opposite of the intended behaviour. The prefix guard is still proven by
    // the remaining paths — none of them is a publicRoutes entry, so any one
    // of them turning public again means the bare-prefix bug is back.
    for (const pathname of [
      "/register",
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
