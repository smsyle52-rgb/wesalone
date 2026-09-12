// @vitest-environment node

import { describe, expect, test } from "vitest"

import { isPublicRoute } from "@/lib/public-routes"

describe("isPublicRoute", () => {
  test("allows the routes that must be reachable signed out", () => {
    for (const pathname of [
      "/",
      "/pricing",
      "/about",
      "/features",
      "/channels",
      "/auth/sign-in",
      "/auth/sign-up",
      "/api/health",
      "/integrations/whatsapp/callback",
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

  test("keeps the connect flow private even though /channels is public", () => {
    // `/channels` is the marketing page; `/channels/create` beneath it is the
    // authenticated connect flow, and was public from 14 Aug to 9 Sep 2026.
    // Signed out it answered 404 instead of the sign-in redirect, so a
    // merchant whose session lapsed mid-connect was told the page does not
    // exist. Meta's own callback lands on `/integrations/...`, not here, so
    // gating this path does not touch the OAuth return.
    for (const pathname of [
      "/channels/create",
      "/channels/create/messenger",
    ]) {
      expect(isPublicRoute(pathname), pathname).toBe(false)
    }
    expect(isPublicRoute("/channels")).toBe(true)
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
