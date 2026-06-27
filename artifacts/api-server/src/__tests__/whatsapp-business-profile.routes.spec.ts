import { createServer, type Server } from "node:http";
import express, { Router, type Express, type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiLimiter } from "../lib/rateLimiter";
import { requireVerifiedEmail } from "../middlewares/requireVerifiedEmail";
import { BUSINESS_PROFILE_IMAGE_MAX_BYTES } from "../modules/whatsapp-management/whatsapp-business-profile.schema";
import { WhatsAppBusinessProfileError } from "../services/meta-whatsapp-business-profile";
import type { SessionUser } from "../lib/types";

const serviceMocks = vi.hoisted(() => ({
  syncBusinessProfile: vi.fn(),
  updateBusinessProfile: vi.fn(),
  updateBusinessProfilePhoto: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({ createAuditLog: vi.fn() }));

vi.mock("../modules/whatsapp-management/whatsapp-business-profile.service", () => serviceMocks);
vi.mock("../lib/audit", () => ({
  auditFromRequest: (_req: unknown, sessionUser: SessionUser) => ({
    workspaceId: sessionUser.activeWorkspaceId,
    actorType: "user",
    actorId: sessionUser.userId,
    actorLabel: sessionUser.name,
  }),
  createAuditLog: auditMocks.createAuditLog,
}));

import whatsappBusinessProfileRouter from "../modules/whatsapp-management/whatsapp-business-profile.routes";

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000010";

type FetchInit = Parameters<typeof fetch>[1];
type FetchResponse = Awaited<ReturnType<typeof fetch>>;
type JsonObject = Record<string, unknown>;

async function readJsonObject(response: FetchResponse): Promise<JsonObject> {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a JSON object response");
  }
  return value as JsonObject;
}

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "00000000-0000-4000-8000-000000000100",
    activeWorkspaceId: WORKSPACE_ID,
    activeMembershipId: "00000000-0000-4000-8000-000000000200",
    permissions: ["integrations:read", "integrations:update"],
    roleSlugs: ["owner"],
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    ...overrides,
  };
}

function successResult() {
  return {
    account: { id: ACCOUNT_ID, displayName: "WhatsApp test" },
    profile: { about: "وصال ون" },
    syncedAt: "2026-06-27T10:00:00.000Z",
  };
}

function buildApp(sessionUser: SessionUser | null): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(session({
    secret: "whatsapp-business-profile-test-secret",
    resave: false,
    saveUninitialized: false,
  }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (sessionUser) {
      req.session.user = sessionUser;
    }
    next();
  });
  const protectedApi = Router();
  protectedApi.use(apiLimiter);
  protectedApi.use(requireVerifiedEmail);
  protectedApi.use("/whatsapp-management", whatsappBusinessProfileRouter);
  app.use("/api", protectedApi);
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error.message, code: "TEST_INTERNAL_ERROR" });
  });
  return app;
}

async function listen(app: Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("WhatsApp Business Profile routes", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.syncBusinessProfile.mockResolvedValue(successResult());
    serviceMocks.updateBusinessProfile.mockResolvedValue(successResult());
    serviceMocks.updateBusinessProfilePhoto.mockResolvedValue(successResult());
    auditMocks.createAuditLog.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  async function request(sessionUser: SessionUser | null, path: string, init?: FetchInit) {
    const running = await listen(buildApp(sessionUser));
    servers.push(running.server);
    return fetch(`${running.baseUrl}${path}`, init);
  }

  it("rejects an unauthenticated user", async () => {
    const response = await request(null, `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`);
    expect(response.status).toBe(401);
    const body = await readJsonObject(response);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("rejects an unverified email before entering the feature router", async () => {
    const response = await request(user({ emailVerified: false }), `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`);
    expect(response.status).toBe(403);
    const body = await readJsonObject(response);
    expect(body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("requires integrations:read for GET", async () => {
    const response = await request(user({ permissions: [] }), `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`);
    expect(response.status).toBe(403);
    const body = await readJsonObject(response);
    expect(body.requiredPermission).toBe("integrations:read");
  });

  it("requires integrations:update for PATCH", async () => {
    const response = await request(
      user({ permissions: ["integrations:read"] }),
      `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ about: "وصال ون" }) },
    );
    expect(response.status).toBe(403);
    const body = await readJsonObject(response);
    expect(body.requiredPermission).toBe("integrations:update");
  });

  it("passes only activeWorkspaceId to the service and rejects another workspace", async () => {
    serviceMocks.syncBusinessProfile.mockRejectedValue(new WhatsAppBusinessProfileError(
      404,
      "حساب واتساب غير موجود في مساحة العمل الحالية",
      "WHATSAPP_ACCOUNT_NOT_FOUND",
    ));
    const response = await request(user(), `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`);
    expect(response.status).toBe(404);
    const body = await readJsonObject(response);
    expect(body.code).toBe("WHATSAPP_ACCOUNT_NOT_FOUND");
    expect(serviceMocks.syncBusinessProfile).toHaveBeenCalledWith(WORKSPACE_ID, ACCOUNT_ID);
  });

  it("returns a clear inactive-account error", async () => {
    serviceMocks.syncBusinessProfile.mockRejectedValue(new WhatsAppBusinessProfileError(
      409,
      "حساب واتساب غير نشط أو غير متصل، ولا يمكن إدارة ملفه التجاري حاليًا.",
      "WHATSAPP_ACCOUNT_INACTIVE",
    ));
    const response = await request(user(), `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`);
    expect(response.status).toBe(409);
    const body = await readJsonObject(response);
    expect(body.code).toBe("WHATSAPP_ACCOUNT_INACTIVE");
  });

  it("updates the profile successfully through PATCH", async () => {
    const response = await request(
      user(),
      `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ about: "وصال ون" }) },
    );
    expect(response.status).toBe(200);
    const body = await readJsonObject(response);
    expect(body.source).toBe("meta");
    expect(serviceMocks.updateBusinessProfile).toHaveBeenCalledWith(WORKSPACE_ID, ACCOUNT_ID, { about: "وصال ون" });
  });

  it("does not convert a Meta failure into success", async () => {
    serviceMocks.updateBusinessProfile.mockRejectedValue(new WhatsAppBusinessProfileError(
      502,
      "تعذر إكمال العملية لدى Meta. لم يتم تسجيل نجاح محلي.",
      "META_BUSINESS_PROFILE_ERROR",
      { code: 190 },
    ));
    const response = await request(
      user(),
      `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ about: "وصال ون" }) },
    );
    expect(response.status).toBe(502);
    const body = await readJsonObject(response);
    expect(body.code).toBe("META_BUSINESS_PROFILE_ERROR");
  });

  it("rejects an unsupported profile image MIME type", async () => {
    const response = await request(
      user(),
      `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile/photo`,
      { method: "POST", headers: { "Content-Type": "image/gif" }, body: new Uint8Array(Buffer.from("GIF89a")) },
    );
    expect(response.status).toBe(415);
    const body = await readJsonObject(response);
    expect(body.code).toBe("PROFILE_IMAGE_MIME_NOT_ALLOWED");
  });

  it("rejects a profile image larger than the configured limit", async () => {
    const response = await request(
      user(),
      `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile/photo`,
      {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array(BUSINESS_PROFILE_IMAGE_MAX_BYTES + 1),
      },
    );
    expect(response.status).toBe(413);
    const body = await readJsonObject(response);
    expect(body.code).toBe("PROFILE_IMAGE_TOO_LARGE");
  });

  it("serves the final route under /api/whatsapp-management and passes through apiLimiter", async () => {
    const response = await request(user(), `/api/whatsapp-management/accounts/${ACCOUNT_ID}/business-profile`);
    expect(response.status).toBe(200);
    const rateLimitHeaders = [...response.headers.keys()].filter((name) => name.startsWith("ratelimit"));
    expect(rateLimitHeaders.length).toBeGreaterThan(0);
  });
});
