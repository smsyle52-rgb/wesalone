import { Router } from "express";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[][], apply: vi.fn() }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    conversationsTable: table,
    contactsTable: table,
    workspaceMembershipsTable: table,
    usersTable: table,
    db: { select: () => {
      const rows = state.rows.shift() ?? [];
      const chain: any = {};
      chain.from = () => chain;
      chain.leftJoin = () => chain;
      chain.where = () => chain;
      chain.limit = async () => rows;
      return chain;
    }},
  };
});
vi.mock("../middlewares/requireSession", () => ({ requireSession: (_req: any, _res: any, next: any) => next() }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../lib/audit", () => ({ auditFromRequest: () => ({}), createAuditLog: vi.fn() }));
vi.mock("../modules/conversations/conversation-lifecycle-route-common", () => ({
  unifiedOnly: (_req: any, _res: any, next: any) => next(),
  addContactTimeline: vi.fn(),
}));
vi.mock("../modules/conversations/conversation.service", () => ({
  applyConversationLifecycleEventAtomic: state.apply,
}));

import { registerUnifiedConversationAssignRoute } from "../modules/conversations/conversation-lifecycle-assign.routes";

async function call(body: unknown) {
  const router = Router();
  registerUnifiedConversationAssignRoute(router);
  const route: any = (router as any).stack[0].route;
  const req: any = {
    params: { id: "conversation-1" },
    body,
    sessionUser: { activeWorkspaceId: "workspace-1", userId: "user-1" },
  };
  let payload: any;
  const res: any = { status: () => res, json: (value: any) => { payload = value; return res; } };
  await new Promise<void>((resolve, reject) => route.dispatch(req, res, (error: unknown) => error ? reject(error) : resolve()));
  return payload;
}

describe("actual assign lifecycle route", () => {
  it("assigns then unassigns using the registered handler", async () => {
    const member = "44444444-4444-4444-8444-444444444444";
    const open = { id: "conversation-1", status: "open", assignedMembershipId: null, needsHuman: false, contactId: null };
    state.rows.push([open], [{ id: member, name: "Sara" }]);
    state.apply.mockResolvedValueOnce({
      kind: "written",
      conversation: { ...open, assignedMembershipId: member, needsHuman: true, agentStatus: "human" },
    });
    expect((await call({ membershipId: member })).conversation).toMatchObject({ assignedMembershipId: member, needsHuman: true });

    const human = { ...open, assignedMembershipId: member, needsHuman: true };
    state.rows.push([human]);
    state.apply.mockResolvedValueOnce({
      kind: "written",
      conversation: { ...human, assignedMembershipId: null, needsHuman: false, agentStatus: "paused" },
    });
    expect((await call({ membershipId: null })).conversation).toMatchObject({ assignedMembershipId: null, needsHuman: false, agentStatus: "paused" });
  });
});
