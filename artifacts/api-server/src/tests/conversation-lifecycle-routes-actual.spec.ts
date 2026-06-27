import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const env = { UNIFIED_LIFECYCLE: true };
  const state = {
    selectQueue: [] as unknown[][],
    updateBase: {} as Record<string, unknown>,
    updates: [] as Record<string, unknown>[],
    timeline: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
    emitted: [] as Record<string, unknown>[],
    domainEvents: [] as Record<string, unknown>[],
    lastDirection: "inbound" as string | null,
    session: {
      activeWorkspaceId: "11111111-1111-4111-8111-111111111111",
      activeMembershipId: "22222222-2222-4222-8222-222222222222",
      userId: "33333333-3333-4333-8333-333333333333",
      name: "Tester",
      email: "test@example.com",
      permissions: ["conversations:resolve", "conversations:assign", "conversations:read"],
    },
  };
  return { env, state, apply: vi.fn() };
});

vi.mock("drizzle-orm", () => {
  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => ({ strings, values });
  return {
    and: (...values: unknown[]) => values,
    eq: (...values: unknown[]) => values,
    desc: (value: unknown) => value,
    asc: (value: unknown) => value,
    count: () => 0,
    ilike: (...values: unknown[]) => values,
    or: (...values: unknown[]) => values,
    sql,
  };
});

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __name: name }, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return `${name}.${String(property)}`;
    },
  });

  const contactTimelineTable = table("contact_timeline");
  const domainEventsTable = table("domain_events");

  const select = vi.fn(() => {
    const rows = mocks.state.selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "leftJoin", "where", "orderBy", "groupBy", "offset", "for"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(async () => rows);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  });

  const update = vi.fn(() => {
    let values: Record<string, unknown> = {};
    const chain = {
      set(input: Record<string, unknown>) {
        values = input;
        mocks.state.updates.push(input);
        return chain;
      },
      where() { return chain; },
      async returning() {
        return [{ ...mocks.state.updateBase, ...values }];
      },
    };
    return chain;
  });

  const insert = vi.fn((target: unknown) => ({
    async values(value: Record<string, unknown>) {
      if (target === contactTimelineTable) mocks.state.timeline.push(value);
      if (target === domainEventsTable) mocks.state.domainEvents.push(value);
      return [];
    },
  }));

  return {
    db: { select, update, insert },
    conversationsTable: table("conversations"),
    messagesTable: table("messages"),
    contactsTable: table("contacts"),
    contactChannelsTable: table("contact_channels"),
    contactTimelineTable,
    workspaceMembershipsTable: table("workspace_memberships"),
    usersTable: table("users"),
    ticketsTable: table("tickets"),
    outboxEventsTable: table("outbox_events"),
    domainEventsTable,
  };
});

vi.mock("../lib/env", () => ({ env: mocks.env }));
vi.mock("../middlewares/requireSession", () => ({
  requireSession: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.sessionUser = { ...mocks.state.session, permissions: [...mocks.state.session.permissions] };
    next();
  },
}));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: (permission: string) => (
    req: { sessionUser: { permissions: string[] } },
    res: { status: (code: number) => { json: (value: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.sessionUser.permissions.includes(permission)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  },
}));
vi.mock("../lib/audit", () => ({
  auditFromRequest: () => ({}),
  createAuditLog: async (value: Record<string, unknown>) => { mocks.state.audit.push(value); },
}));
vi.mock("../lib/events", () => ({
  emitWorkspaceEvent: (value: Record<string, unknown>) => { mocks.state.emitted.push(value); },
  publishDomainEvent: vi.fn(),
}));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../services/meta-media", () => ({ fetchMetaMediaStream: vi.fn() }));

vi.mock("../modules/conversations/conversation.service", async () => {
  const actual = await vi.importActual<typeof import("../modules/conversations/conversation.service")>(
    "../modules/conversations/conversation.service",
  );
  return { ...actual, applyConversationLifecycleEventAtomic: mocks.apply };
});

import conversationsRouter from "../modules/conversations/conversations.routes";

async function request(
  path: string,
  body: Record<string, unknown>,
  options: { manager?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const previous = [...mocks.state.session.permissions];
  if (options.manager) mocks.state.session.permissions.push("channels:manage");

  const app = express();
  app.use(express.json());
  app.use("/conversations", conversationsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/conversations${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    mocks.state.session.permissions = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeTransaction() {
  return {
    select: () => {
      const rows = mocks.state.lastDirection ? [{ direction: mocks.state.lastDirection }] : [];
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => rows,
      };
      return chain;
    },
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        mocks.state.domainEvents.push(value);
        return [];
      },
    }),
  };
}

function writtenResult(previous: Record<string, unknown>, conversation: Record<string, unknown>) {
  return {
    kind: "written" as const,
    previous,
    conversation,
    plan: {},
    transition: { outcome: "applied" },
    lifecycleChanged: true,
  };
}

beforeEach(() => {
  mocks.env.UNIFIED_LIFECYCLE = true;
  mocks.state.selectQueue = [];
  mocks.state.updateBase = {};
  mocks.state.updates = [];
  mocks.state.timeline = [];
  mocks.state.audit = [];
  mocks.state.emitted = [];
  mocks.state.domainEvents = [];
  mocks.state.lastDirection = "inbound";
  mocks.state.session.permissions = ["conversations:resolve", "conversations:assign", "conversations:read"];
  mocks.apply.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("real dashboard lifecycle routes", () => {
  it("keeps the legacy status writer untouched while the flag is false", async () => {
    mocks.env.UNIFIED_LIFECYCLE = false;
    const existing = { id: "c1", status: "open", contactId: null, contactName: null };
    mocks.state.selectQueue.push([existing]);
    mocks.state.updateBase = { ...existing };

    const response = await request("/c1/status", { status: "bot" });

    expect(response.status).toBe(200);
    expect(response.body.conversation).toMatchObject({ status: "bot" });
    expect(mocks.state.updates[0]).toMatchObject({ status: "bot" });
    expect(mocks.state.updates[0]).not.toHaveProperty("lifecycleState");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("returns canonical pending for bot and records requested/canonical values consistently", async () => {
    const existing = {
      id: "c1", status: "open", lifecycleState: "open", aiSubstate: "ai_active",
      agentStatus: "active", agentPausedUntil: null, needsHuman: false,
      assignedMembershipId: null, closedAt: null, contactId: "contact-1", contactName: "Ali",
    };
    mocks.state.selectQueue.push([existing]);
    mocks.apply.mockImplementation(async (operation) => {
      expect(operation.event).toMatchObject({ type: "set_lifecycle", target: "pending" });
      const conversation = {
        ...existing,
        ...operation.additionalUpdates?.(existing, {} as never),
        status: "pending",
        lifecycleState: "pending",
      };
      await operation.onWritten?.({
        transaction: fakeTransaction() as never,
        previous: existing as never,
        conversation: conversation as never,
        plan: {} as never,
        lifecycleChanged: true,
      });
      return writtenResult(existing, conversation) as never;
    });

    const response = await request("/c1/status", { status: "bot" });

    expect(response.status).toBe(200);
    expect(response.body.conversation).toMatchObject({ status: "pending", lifecycleState: "pending" });
    expect(mocks.state.audit[0]?.newData).toMatchObject({ requestedStatus: "bot", canonicalStatus: "pending" });
    expect(mocks.state.timeline[0]?.title).toContain("pending");
    expect(mocks.state.domainEvents[0]?.payload).toMatchObject({ requestedStatus: "bot", canonicalStatus: "pending" });
  });

  it("stores closed as resolved with closedAt and protects reopening with manager permission", async () => {
    const resolved = {
      id: "c1", status: "resolved", lifecycleState: "resolved", aiSubstate: "ai_paused",
      agentStatus: "paused", agentPausedUntil: null, needsHuman: false,
      assignedMembershipId: null, closedAt: null, contactId: null, contactName: null,
    };
    mocks.state.selectQueue.push([resolved]);
    mocks.apply.mockImplementationOnce(async (operation) => {
      const supplemental = operation.additionalUpdates?.(resolved, {} as never) ?? {};
      const conversation = { ...resolved, ...supplemental, status: "resolved", lifecycleState: "resolved" };
      await operation.onWritten?.({
        transaction: fakeTransaction() as never,
        previous: resolved as never,
        conversation: conversation as never,
        plan: {} as never,
        lifecycleChanged: false,
      });
      return writtenResult(resolved, conversation) as never;
    });

    const closed = await request("/c1/status", { status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.conversation).toMatchObject({ status: "resolved", lifecycleState: "resolved" });
    expect((closed.body.conversation as Record<string, unknown>).closedAt).toBeTruthy();
    expect(mocks.state.audit[0]?.newData).toMatchObject({ requestedStatus: "closed", canonicalStatus: "resolved" });

    const finalClosed = { ...resolved, closedAt: new Date("2026-06-27T12:00:00.000Z") };
    mocks.state.selectQueue.push([finalClosed]);
    const denied = await request("/c1/status", { status: "open" });
    expect(denied.status).toBe(422);

    mocks.state.selectQueue.push([finalClosed]);
    mocks.apply.mockImplementationOnce(async (operation) => {
      const conversation = {
        ...finalClosed,
        ...operation.additionalUpdates?.(finalClosed, {} as never),
        status: "open",
        lifecycleState: "open",
      };
      return writtenResult(finalClosed, conversation) as never;
    });
    const reopened = await request("/c1/status", { status: "open" }, { manager: true });
    expect(reopened.status).toBe(200);
    expect(reopened.body.conversation).toMatchObject({ status: "open", lifecycleState: "open", closedAt: null });
  });

  it("lets a normal resolved conversation reopen without manager permission", async () => {
    const resolved = {
      id: "c1", status: "resolved", lifecycleState: "resolved", aiSubstate: "ai_paused",
      agentStatus: "paused", agentPausedUntil: null, needsHuman: false,
      assignedMembershipId: null, closedAt: null, contactId: null, contactName: null,
    };
    mocks.state.selectQueue.push([resolved]);
    mocks.apply.mockImplementationOnce(async (operation) => {
      const conversation = {
        ...resolved,
        ...operation.additionalUpdates?.(resolved, {} as never),
        status: "open",
        lifecycleState: "open",
      };
      return writtenResult(resolved, conversation) as never;
    });
    const response = await request("/c1/status", { status: "open" });
    expect(response.status).toBe(200);
    expect(response.body.conversation).toMatchObject({ status: "open", closedAt: null });
  });

  it("uses the actual assign route for assign and unassign", async () => {
    const membershipId = "44444444-4444-4444-8444-444444444444";
    const open = {
      id: "c1", status: "open", lifecycleState: "open", aiSubstate: "ai_active",
      agentStatus: "active", agentPausedUntil: null, needsHuman: false,
      assignedMembershipId: null, contactId: null, contactName: null,
    };
    mocks.state.selectQueue.push([open], [{ id: membershipId, name: "Sara" }]);
    mocks.apply.mockImplementationOnce(async (operation) => {
      const conversation = {
        ...open,
        ...operation.additionalUpdates?.(open, {} as never),
        lifecycleState: "open",
        aiSubstate: "human_controlled",
        status: "open",
        agentStatus: "human",
      };
      return writtenResult(open, conversation) as never;
    });
    const assigned = await request("/c1/assign", { membershipId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.conversation).toMatchObject({
      assignedMembershipId: membershipId,
      needsHuman: true,
      aiSubstate: "human_controlled",
      agentStatus: "human",
    });

    const human = assigned.body.conversation as Record<string, unknown>;
    mocks.state.selectQueue.push([human]);
    mocks.apply.mockImplementationOnce(async (operation) => {
      const conversation = {
        ...human,
        ...operation.additionalUpdates?.(human as never, {} as never),
        lifecycleState: "open",
        aiSubstate: "ai_paused",
        status: "open",
        agentStatus: "paused",
      };
      return writtenResult(human, conversation) as never;
    });
    const unassigned = await request("/c1/assign", { membershipId: null });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.conversation).toMatchObject({
      assignedMembershipId: null,
      needsHuman: false,
      aiSubstate: "ai_paused",
      agentStatus: "paused",
    });
  });

  it.each([
    { name: "needsHuman conflict", previous: { aiSubstate: "ai_active", agentStatus: "active", needsHuman: true } },
    { name: "legacy paused conflict", previous: { aiSubstate: "ai_active", agentStatus: "paused", needsHuman: false } },
    { name: "legacy null lifecycle", previous: { aiSubstate: null, lifecycleState: null, agentStatus: "paused", needsHuman: false } },
  ])("creates one reactivation event through the real route for $name", async ({ previous }) => {
    const base: Record<string, unknown> = {
      id: "c1", subject: null, status: "open", lifecycleState: "open",
      aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: null,
      needsHuman: false, assignedMembershipId: null, consecutiveAgentReplies: 0,
    };
    Object.assign(base, previous);
    const active = {
      ...base,
      lifecycleState: "open",
      aiSubstate: "ai_active",
      agentStatus: "active",
      agentPausedUntil: null,
      needsHuman: false,
      assignedMembershipId: null,
    };
    mocks.state.selectQueue.push([base]);
    mocks.apply.mockImplementationOnce(async (operation) => {
      await operation.onWritten?.({
        transaction: fakeTransaction() as never,
        previous: base as never,
        conversation: active as never,
        plan: {} as never,
        lifecycleChanged: true,
      });
      return writtenResult(base, active) as never;
    });
    const first = await request("/c1/agent-status", { status: "active" });
    expect(first.status).toBe(200);
    expect(mocks.state.domainEvents.filter((event) => event.eventType === "message.received")).toHaveLength(1);

    mocks.state.selectQueue.push([active]);
    mocks.apply.mockResolvedValueOnce({ kind: "noop", conversation: active, plan: {}, transition: { outcome: "noop" } });
    const second = await request("/c1/agent-status", { status: "active" });
    expect(second.status).toBe(200);
    expect(mocks.state.domainEvents.filter((event) => event.eventType === "message.received")).toHaveLength(1);
  });

  it.each(["resolved", "snoozed"])("does not reactivate or emit while %s", async (status) => {
    const existing = {
      id: "c1", subject: null, status, lifecycleState: status,
      aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: null,
      needsHuman: false, assignedMembershipId: null, consecutiveAgentReplies: 0,
    };
    mocks.state.selectQueue.push([existing]);
    mocks.apply.mockResolvedValueOnce({
      kind: "rejected",
      current: existing,
      plan: {},
      transition: { outcome: "rejected", reason: status === "resolved" ? "CONVERSATION_RESOLVED" : "CONVERSATION_SNOOZED" },
    });
    const response = await request("/c1/agent-status", { status: "active" });
    expect(response.status).toBe(422);
    expect(mocks.state.domainEvents).toHaveLength(0);
  });

  it("keeps workspace isolation at the HTTP boundary", async () => {
    mocks.state.selectQueue.push([]);
    const response = await request("/other/status", { status: "resolved" });
    expect(response.status).toBe(404);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
