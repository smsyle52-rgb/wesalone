/**
 * conversation-labels.routes.spec.ts — W3-T3 conversation labels CRUD
 *
 * POST/DELETE /:id/labels add/remove a label on conversations.labels (text[]),
 * scoped to the caller's workspace. Unit-level: mocked DB, no DATABASE_URL needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express, { Router, type Express, type NextFunction, type Request, type Response } from "express";
import type { SessionUser } from "../lib/types";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "test_session_secret_at_least_32_chars_long";
  process.env.PORT ??= "8080";
});

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000010";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000020";

const dbState = vi.hoisted(() => ({
  conversationRow: null as { id: string; labels: string[] } | null,
  updatedLabels: [] as string[],
}));

vi.mock("@workspace/db", () => {
  const selectChain: any = {
    from: () => selectChain,
    leftJoin: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(dbState.conversationRow ? [dbState.conversationRow] : []),
  };
  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => Promise.resolve([{ labels: dbState.updatedLabels }]),
  };
  return {
    db: {
      select: () => selectChain,
      update: () => updateChain,
    },
    conversationsTable: { id: "id", workspaceId: "workspaceId", labels: "labels" },
    messagesTable: {},
    contactsTable: {},
    contactChannelsTable: {},
    contactTimelineTable: {},
    workspaceMembershipsTable: {},
    usersTable: {},
    ticketsTable: {},
    outboxEventsTable: {},
  };
});

vi.mock("../lib/audit", () => ({
  createAuditLog: vi.fn(),
  auditFromRequest: () => ({}),
}));
vi.mock("../lib/events", () => ({
  emitWorkspaceEvent: vi.fn(),
  publishDomainEvent: vi.fn(),
}));

import conversationsRouter from "../modules/conversations/conversations.routes";

function user(): SessionUser {
  return {
    userId: "00000000-0000-4000-8000-000000000100",
    activeWorkspaceId: WORKSPACE_ID,
    activeMembershipId: "00000000-0000-4000-8000-000000000200",
    permissions: ["conversations:read", "conversations:update"],
    roleSlugs: ["owner"],
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
  } as SessionUser;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { user: user() };
    next();
  });
  const api = Router();
  api.use("/conversations", conversationsRouter);
  app.use("/api", api);
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
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe("W3-T3: conversation labels CRUD", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    dbState.conversationRow = { id: CONVERSATION_ID, labels: [] };
    dbState.updatedLabels = [];
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("adds a label to a conversation", async () => {
    dbState.updatedLabels = ["vip"];
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "vip" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.labels).toEqual(["vip"]);
  });

  it("is idempotent — adding a label that already exists is a no-op", async () => {
    dbState.conversationRow = { id: CONVERSATION_ID, labels: ["vip"] };
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "vip" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.labels).toEqual(["vip"]);
  });

  it("removes a label from a conversation", async () => {
    dbState.conversationRow = { id: CONVERSATION_ID, labels: ["vip", "urgent"] };
    dbState.updatedLabels = ["urgent"];
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/labels/vip`, { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.labels).toEqual(["urgent"]);
  });

  it("404s when the conversation does not resolve in the caller's workspace", async () => {
    dbState.conversationRow = null;
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "vip" }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects an empty label", async () => {
    const { server, baseUrl } = await listen(buildApp());
    servers.push(server);

    const res = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "" }),
    });

    expect(res.status).toBe(400);
  });
});
