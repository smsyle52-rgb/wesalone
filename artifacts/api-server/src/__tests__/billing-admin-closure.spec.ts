import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/types";

function setRequiredEnv(platformAdmins?: string) {
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.PORT = "8080";
  if (platformAdmins === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  } else {
    process.env.PLATFORM_ADMIN_EMAILS = platformAdmins;
  }
}

function responseRecorder() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res as Response & typeof res;
}

function requestWithEmail(email: string): AuthenticatedRequest {
  return {
    sessionUser: {
      userId: "user-1",
      email,
      roleSlugs: ["owner"],
      permissions: [],
      activeWorkspaceId: "workspace-1",
    },
  } as unknown as AuthenticatedRequest;
}

describe("billing admin closure", () => {
  it("fails closed when PLATFORM_ADMIN_EMAILS is not configured", async () => {
    vi.resetModules();
    setRequiredEnv(undefined);
    const { requirePlatformAdmin, isPlatformAdminEmail } = await import("../middlewares/requirePlatformAdmin");

    const res = responseRecorder();
    expect(requirePlatformAdmin(requestWithEmail("owner@example.com"), res)).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(isPlatformAdminEmail("smsyle52@gmail.com")).toBe(false);
  });

  it("allows only configured platform admins, not workspace owners", async () => {
    vi.resetModules();
    setRequiredEnv("smsyle52@gmail.com, billing@wesal.one");
    const { requirePlatformAdmin, isPlatformAdminEmail } = await import("../middlewares/requirePlatformAdmin");

    const ownerRes = responseRecorder();
    expect(requirePlatformAdmin(requestWithEmail("owner@example.com"), ownerRes)).toBe(false);
    expect(ownerRes.statusCode).toBe(403);

    const adminRes = responseRecorder();
    expect(requirePlatformAdmin(requestWithEmail("SMSYLE52@gmail.com"), adminRes)).toBe(true);
    expect(adminRes.statusCode).toBe(200);
    expect(isPlatformAdminEmail("billing@wesal.one")).toBe(true);
  });

  it("uses Gemini Flash point rate: one point per 1000 tokens by default", async () => {
    vi.resetModules();
    delete process.env.TOKENS_PER_POINT;
    const { TOKENS_PER_POINT, pointsForTokens } = await import("../lib/model-router");

    expect(TOKENS_PER_POINT).toBe(1000);
    expect(pointsForTokens(1)).toBe(1);
    expect(pointsForTokens(1000)).toBe(1);
    expect(pointsForTokens(1001)).toBe(2);
    expect(pointsForTokens(2500)).toBe(3);
  });
});
