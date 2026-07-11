import { createServer, type Server } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../lib/types";
import integrationsRouter from "../modules/integrations/integrations.routes";

const USER_ID = "00000000-0000-4000-8000-000000000100";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000200";
const STANDARD_CONFIG_ID = "standard-config-id";
const COEXISTENCE_CONFIG_ID = "coexistence-config-id";

type TestSession = {
  user: SessionUser;
  metaWhatsAppRedirectState?: Record<string, unknown>;
  metaMobileRedirectResult?: Record<string, unknown>;
  save: (callback: (error?: unknown) => void) => void;
};

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: USER_ID,
    activeWorkspaceId: WORKSPACE_ID,
    activeMembershipId: "00000000-0000-4000-8000-000000000300",
    permissions: ["integrations:read", "integrations:update"],
    roleSlugs: ["owner"],
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    ...overrides,
  };
}

function session(sessionUser = user()): TestSession {
  return { user: sessionUser, save: (callback) => callback() };
}

function buildApp(testSession: TestSession): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = testSession;
    next();
  });
  app.use("/api/integrations", integrationsRouter);
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

describe("Meta WhatsApp mobile Embedded Signup redirect", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    process.env.META_MOBILE_REDIRECT_ENABLED = "true";
    process.env.META_APP_ID = "123456789";
    process.env.META_GRAPH_VERSION = "v22.0";
    process.env.META_WHATSAPP_STANDARD_CONFIG_ID = STANDARD_CONFIG_ID;
    process.env.META_WHATSAPP_COEXISTENCE_CONFIG_ID = COEXISTENCE_CONFIG_ID;
    process.env.PUBLIC_BASE_URL = "https://www.wesal.one";
    delete process.env.META_REDIRECT_URI;
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
    delete process.env.META_MOBILE_REDIRECT_ENABLED;
  });

  async function request(testSession: TestSession, path: string, init?: RequestInit) {
    const running = await listen(buildApp(testSession));
    servers.push(running.server);
    return fetch(`${running.baseUrl}${path}`, { redirect: "manual", ...init });
  }

  async function start(testSession: TestSession, configKey: string, configId: string, returnTo = "/onboarding") {
    const query = new URLSearchParams({ configKey, configId, returnTo });
    return request(testSession, `/api/integrations/meta/embedded-signup/whatsapp/redirect/start?${query}`);
  }

  it("is disabled unless the feature flag is explicitly true", async () => {
    delete process.env.META_MOBILE_REDIRECT_ENABLED;
    const response = await start(session(), "whatsapp_standard", STANDARD_CONFIG_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ enabled: false, code: "meta_mobile_redirect_disabled" });
  });

  it("builds Standard with the configured config and no broad OAuth scopes", async () => {
    const testSession = session();
    const before = Date.now();
    const response = await start(testSession, "whatsapp_standard", STANDARD_CONFIG_ID);
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string; signupAttemptId: string };
    const url = new URL(body.url);
    expect(url.pathname).toBe("/v22.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe(STANDARD_CONFIG_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(JSON.parse(url.searchParams.get("extras") ?? "{}")).toEqual({ sessionInfoVersion: "3", version: "v4" });
    expect(testSession.metaWhatsAppRedirectState).toMatchObject({
      signupAttemptId: body.signupAttemptId,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      configKey: "whatsapp_standard",
      configId: STANDARD_CONFIG_ID,
      returnTo: "/onboarding",
    });
    expect(testSession.metaWhatsAppRedirectState?.createdAt).toEqual(expect.any(Number));
    expect(Number(testSession.metaWhatsAppRedirectState?.expiresAt)).toBeGreaterThanOrEqual(before + 15 * 60_000);
  });

  it("builds Coexistence with its configured config and exact extras", async () => {
    const response = await start(session(), "whatsapp_coexistence", COEXISTENCE_CONFIG_ID);
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    const url = new URL(body.url);
    expect(url.searchParams.get("config_id")).toBe(COEXISTENCE_CONFIG_ID);
    expect(JSON.parse(url.searchParams.get("extras") ?? "{}")).toEqual({
      setup: {},
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3",
      version: "v4",
    });
  });

  it("rejects unknown config keys, config IDs, and return paths", async () => {
    expect((await start(session(), "instagram_messenger", "anything")).status).toBe(400);
    expect((await start(session(), "whatsapp_standard", "wrong-config-id")).status).toBe(400);
    expect((await start(session(), "whatsapp_standard", STANDARD_CONFIG_ID, "/admin")).status).toBe(400);
  });

  it("rejects expired and cross-workspace states", async () => {
    const expired = session();
    expired.metaWhatsAppRedirectState = {
      nonce: "expired",
      signupAttemptId: "attempt-expired",
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      configKey: "whatsapp_standard",
      configId: STANDARD_CONFIG_ID,
      returnTo: "/onboarding",
      createdAt: Date.now() - 16 * 60_000,
      expiresAt: Date.now() - 60_000,
    };
    expect((await request(expired, "/api/integrations/meta/embedded-signup/callback?state=expired&code=unused")).status).toBe(403);

    const otherWorkspace = session();
    otherWorkspace.metaWhatsAppRedirectState = {
      ...expired.metaWhatsAppRedirectState,
      nonce: "other-workspace",
      expiresAt: Date.now() + 15 * 60_000,
      workspaceId: "00000000-0000-4000-8000-000000000999",
    };
    expect((await request(otherWorkspace, "/api/integrations/meta/embedded-signup/callback?state=other-workspace&code=unused")).status).toBe(403);
  });

  it("consumes a valid state before processing and rejects its second callback", async () => {
    const testSession = session();
    testSession.metaWhatsAppRedirectState = {
      nonce: "one-use",
      signupAttemptId: "attempt-one-use",
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      configKey: "whatsapp_standard",
      configId: STANDARD_CONFIG_ID,
      returnTo: "/onboarding",
      createdAt: Date.now(),
      expiresAt: Date.now() + 15 * 60_000,
    };
    const first = await request(testSession, "/api/integrations/meta/embedded-signup/callback?state=one-use");
    expect(first.status).toBe(400);
    expect(testSession.metaWhatsAppRedirectState?.consumedAt).toEqual(expect.any(Number));
    const second = await request(testSession, "/api/integrations/meta/embedded-signup/callback?state=one-use&code=reused");
    expect(second.status).toBe(403);
  });

  it("keeps the existing generic start and /complete contracts available", async () => {
    const generic = await request(session(), "/api/integrations/meta/embedded-signup/start");
    expect(generic.status).toBe(200);
    const genericBody = await generic.json() as { url: string };
    expect(new URL(genericBody.url).searchParams.has("scope")).toBe(true);

    const complete = await request(session(), "/api/integrations/meta/embedded-signup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(complete.status).toBe(400);
    expect(await complete.json()).toMatchObject({ error: "بيانات التسجيل المضمن غير صالحة" });
  });

  it("returns and consumes only the current user's completion result", async () => {
    const testSession = session();
    testSession.metaMobileRedirectResult = {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      signupAttemptId: "attempt-result",
      returnTo: "/onboarding",
    };
    const first = await request(testSession, "/api/integrations/meta/embedded-signup/mobile-redirect/result");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ completed: true, returnTo: "/onboarding", signupAttemptId: "attempt-result" });
    expect(testSession.metaMobileRedirectResult).toBeUndefined();

    const second = await request(testSession, "/api/integrations/meta/embedded-signup/mobile-redirect/result");
    expect(await second.json()).toEqual({ completed: false });
  });
});
