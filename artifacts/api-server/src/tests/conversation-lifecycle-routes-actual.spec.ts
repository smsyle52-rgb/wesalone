import { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  env: { UNIFIED_LIFECYCLE: true }, q: [] as unknown[][],
  audit: [] as any[], timeline: [] as any[], events: [] as any[],
  permissions: ["conversations:resolve", "conversations:assign"] as string[], apply: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({ and: (...x: unknown[]) => x, eq: (...x: unknown[]) => x, desc: (x: unknown) => x }));
vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, { get: (_t, p) => `${name}.${String(p)}` });
  const timeline = table("timeline"), domain = table("domain");
  const select = () => { const rows = m.q.shift() ?? []; const c: any = {}; for (const k of ["from", "leftJoin", "where", "orderBy"]) c[k] = () => c; c.limit = async () => rows; return c; };
  const insert = (target: unknown) => ({ values: async (v: any) => { (target === timeline ? m.timeline : m.events).push(v); return []; } });
  return { db: { select, insert }, conversationsTable: table("conversations"), contactsTable: table("contacts"), messagesTable: table("messages"), workspaceMembershipsTable: table("memberships"), usersTable: table("users"), contactTimelineTable: timeline, domainEventsTable: domain };
});
vi.mock("../lib/env", () => ({ env: m.env }));
vi.mock("../middlewares/requireSession", () => ({ requireSession: (req: any, _res: any, next: any) => { req.sessionUser = { activeWorkspaceId: "w1", activeMembershipId: "m1", userId: "u1", permissions: [...m.permissions] }; next(); } }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: (p: string) => (req: any, res: any, next: any) => req.sessionUser.permissions.includes(p) ? next() : res.status(403).json({ error: "forbidden" }) }));
vi.mock("../lib/audit", () => ({ auditFromRequest: () => ({}), createAuditLog: async (v: any) => m.audit.push(v) }));
vi.mock("../lib/events", () => ({ emitWorkspaceEvent: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../modules/conversations/conversation.service", async () => {
  const actual = await vi.importActual<any>("../modules/conversations/conversation.service");
  return { ...actual, applyConversationLifecycleEventAtomic: m.apply };
});
import { registerUnifiedConversationLifecycleRoutes } from "../modules/conversations/conversation-lifecycle.routes";

async function dispatch(path: string, body: any, manager = false) {
  const old = [...m.permissions]; if (manager) m.permissions.push("channels:manage");
  const router = Router(); registerUnifiedConversationLifecycleRoutes(router);
  router.patch("/:id/status", (_req, res) => res.json({ legacy: true }));
  const layer: any = (router as any).stack.find((x: any) => x.route?.path === path && x.route.methods.patch);
  const req: any = { method: "PATCH", url: path.replace(":id", "c1"), params: { id: "c1" }, body, headers: {} };
  let code = 200, payload: any;
  const res: any = { status(n: number) { code = n; return res; }, json(v: any) { payload = v; return res; } };
  await new Promise<void>((resolve, reject) => layer.route.dispatch(req, res, (err: unknown) => err ? reject(err) : resolve()));
  m.permissions = old;
  return { status: code, body: payload };
}
const tx = () => ({ select: () => { const c: any = {}; c.from = () => c; c.where = () => c; c.orderBy = () => c; c.limit = async () => [{ direction: "inbound" }]; return c; }, insert: () => ({ values: async (v: any) => { m.events.push(v); return []; } }) });
const written = (previous: any, conversation: any) => ({ kind: "written", previous, conversation, plan: {}, transition: { outcome: "applied" }, lifecycleChanged: true });

beforeEach(() => { m.env.UNIFIED_LIFECYCLE = true; m.q = []; m.audit = []; m.timeline = []; m.events = []; m.permissions = ["conversations:resolve", "conversations:assign"]; m.apply.mockReset(); });

describe("W3-T1B.1 registered lifecycle routes", () => {
  it("preserves the flag-off fallback", async () => {
    m.env.UNIFIED_LIFECYCLE = false;
    expect((await dispatch("/:id/status", { status: "bot" })).body).toEqual({ legacy: true });
    expect(m.apply).not.toHaveBeenCalled();
  });
  it("canonicalizes bot across response, audit, timeline, and event", async () => {
    const old = { id: "c1", status: "open", lifecycleState: "open", aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: null, needsHuman: false, assignedMembershipId: null, closedAt: null, contactId: "p1", contactName: "Ali" };
    m.q.push([old]); m.apply.mockImplementation(async (op: any) => { const next = { ...old, status: "pending", lifecycleState: "pending" }; await op.onWritten({ transaction: tx(), previous: old, conversation: next, plan: {}, lifecycleChanged: true }); return written(old, next); });
    const result = await dispatch("/:id/status", { status: "bot" });
    expect(result.body.conversation.status).toBe("pending");
    expect(m.audit[0].newData).toMatchObject({ requestedStatus: "bot", canonicalStatus: "pending" });
    expect(m.timeline[0].title).toContain("pending");
    expect(m.events[0].payload).toMatchObject({ requestedStatus: "bot", canonicalStatus: "pending" });
  });
  it("protects closedAt reopen and clears it for a manager", async () => {
    const closed = { id: "c1", status: "resolved", lifecycleState: "resolved", aiSubstate: "ai_paused", agentStatus: "paused", agentPausedUntil: null, needsHuman: false, assignedMembershipId: null, closedAt: new Date(), contactId: null, contactName: null };
    m.q.push([closed]); expect((await dispatch("/:id/status", { status: "open" })).status).toBe(422);
    m.q.push([closed]); m.apply.mockImplementation(async (op: any) => written(closed, { ...closed, ...op.additionalUpdates(closed, {}), status: "open", lifecycleState: "open" }));
    const reopened = await dispatch("/:id/status", { status: "open" }, true);
    expect(reopened.body.conversation.closedAt).toBeNull();
  });
  it("allows ordinary resolved reopen without manager", async () => {
    const old = { id: "c1", status: "resolved", lifecycleState: "resolved", aiSubstate: "ai_paused", agentStatus: "paused", agentPausedUntil: null, needsHuman: false, assignedMembershipId: null, closedAt: null, contactId: null, contactName: null };
    m.q.push([old]); m.apply.mockImplementation(async (op: any) => written(old, { ...old, ...op.additionalUpdates(old, {}), status: "open", lifecycleState: "open" }));
    expect((await dispatch("/:id/status", { status: "open" })).status).toBe(200);
  });
  it.each([
    { aiSubstate: "ai_active", agentStatus: "active", needsHuman: true },
    { aiSubstate: "ai_active", agentStatus: "paused", needsHuman: false },
    { aiSubstate: null, lifecycleState: null, agentStatus: "paused", needsHuman: false },
  ])("creates one reactivation event for mixed state %o", async (mix) => {
    const old: any = { id: "c1", subject: null, status: "open", lifecycleState: "open", aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: null, needsHuman: false, assignedMembershipId: null, consecutiveAgentReplies: 0, ...mix };
    const active = { ...old, lifecycleState: "open", aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: null, needsHuman: false, assignedMembershipId: null };
    m.q.push([old]); m.apply.mockImplementationOnce(async (op: any) => { await op.onWritten({ transaction: tx(), previous: old, conversation: active, plan: {}, lifecycleChanged: true }); return written(old, active); });
    expect((await dispatch("/:id/agent-status", { status: "active" })).status).toBe(200);
    expect(m.events.filter(e => e.eventType === "message.received")).toHaveLength(1);
    m.q.push([active]); m.apply.mockResolvedValueOnce({ kind: "noop", conversation: active, plan: {}, transition: { outcome: "noop" } });
    await dispatch("/:id/agent-status", { status: "active" });
    expect(m.events.filter(e => e.eventType === "message.received")).toHaveLength(1);
  });
  it.each(["resolved", "snoozed"])("does not reactivate while %s", async (status) => {
    const old = { id: "c1", subject: null, status, lifecycleState: status, aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: null, needsHuman: false, assignedMembershipId: null };
    m.q.push([old]); m.apply.mockResolvedValueOnce({ kind: "rejected", current: old, plan: {}, transition: { outcome: "rejected", reason: "blocked" } });
    expect((await dispatch("/:id/agent-status", { status: "active" })).status).toBe(422);
    expect(m.events).toHaveLength(0);
  });
});
