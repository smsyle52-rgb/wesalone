import { describe, expect, it } from "vitest";
import {
  canUnifiedAgentReply,
  executeAtomicConversationLifecycleTransition,
  lifecycleEventForDashboardAgentStatus,
  lifecycleEventForDashboardStatus,
  planConversationLifecycleTransition,
  shouldPublishAgentReactivationEvent,
  type AtomicLifecycleStore,
} from "../modules/conversations/conversation.service";
import type { ConversationLifecycleRecord, LifecycleEvent } from "../modules/conversations/lifecycle";

type FakeRow = ConversationLifecycleRecord & {
  id: string;
  workspaceId: string;
  lifecycleState: string | null;
  aiSubstate: string | null;
  status: string;
  agentStatus: string;
  assignedMembershipId: string | null;
  needsHuman: boolean;
  updatedAt?: Date;
};

type FakeTransaction = { marker: "tx" };

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "conversation-1",
    workspaceId: "workspace-1",
    lifecycleState: null,
    aiSubstate: null,
    status: "open",
    agentStatus: "active",
    assignedMembershipId: null,
    needsHuman: false,
    ...overrides,
  };
}

function createStore(initialRows: FakeRow[]) {
  let rows = initialRows.map((item) => ({ ...item }));
  let events: string[] = [];
  let writeCount = 0;

  const store: AtomicLifecycleStore<FakeTransaction, FakeRow> = {
    transaction: async (callback) => {
      const rowSnapshot = rows.map((item) => ({ ...item }));
      const eventSnapshot = [...events];
      try {
        return await callback({ marker: "tx" });
      } catch (error) {
        rows = rowSnapshot;
        events = eventSnapshot;
        throw error;
      }
    },
    loadForUpdate: async (_transaction, input) => rows.find(
      (item) => item.id === input.conversationId && item.workspaceId === input.workspaceId,
    ) ?? null,
    write: async (_transaction, input) => {
      const index = rows.findIndex(
        (item) => item.id === input.conversationId && item.workspaceId === input.workspaceId,
      );
      if (index < 0) return null;
      writeCount += 1;
      rows[index] = { ...rows[index], ...input.updates } as FakeRow;
      return { ...rows[index] };
    },
  };

  return {
    store,
    rows: () => rows.map((item) => ({ ...item })),
    events: () => [...events],
    writeCount: () => writeCount,
    addEvent: (event: string) => events.push(event),
  };
}

async function execute(
  fake: ReturnType<typeof createStore>,
  event: LifecycleEvent,
  options: {
    workspaceId?: string;
    additionalUpdates?: Record<string, unknown>;
    shouldWriteNoop?: boolean;
    onWritten?: () => Promise<void>;
    unifiedLifecycleEnabled?: boolean;
  } = {},
) {
  return executeAtomicConversationLifecycleTransition(fake.store, {
    workspaceId: options.workspaceId ?? "workspace-1",
    conversationId: "conversation-1",
    event,
    unifiedLifecycleEnabled: options.unifiedLifecycleEnabled ?? true,
    additionalUpdates: () => options.additionalUpdates ?? { updatedAt: new Date("2026-06-27T00:00:00.000Z") },
    shouldWriteNoop: () => options.shouldWriteNoop ?? false,
    onWritten: async () => {
      await options.onWritten?.();
    },
  });
}

describe("W3-T1B dashboard lifecycle writers", () => {
  it("keeps the exact legacy projection and produces no unified writes while the flag is off", async () => {
    const legacy = row({ status: "bot", agentStatus: "paused" });
    const fake = createStore([legacy]);
    const result = await execute(fake, { type: "resume_ai" }, { unifiedLifecycleEnabled: false });

    expect(result).toMatchObject({
      kind: "disabled",
      plan: {
        enabled: false,
        transition: null,
        updates: {},
        projection: { status: "bot", agentStatus: "paused" },
      },
    });
    expect(fake.rows()[0]).toEqual(legacy);
    expect(fake.writeCount()).toBe(0);
    expect(fake.events()).toEqual([]);
  });

  it("writes lifecycle_state, ai_substate, status, and agent_status atomically", async () => {
    const fake = createStore([row({ agentStatus: "paused" })]);
    const result = await execute(fake, { type: "resume_ai" });

    expect(result.kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });
  });

  it("blocks resolved + ai_active from agent reply and explicit reactivation", async () => {
    const resolved = row({
      lifecycleState: "resolved",
      aiSubstate: "ai_active",
      status: "resolved",
      agentStatus: "active",
    });
    expect(canUnifiedAgentReply(resolved)).toBe(false);

    const fake = createStore([resolved]);
    const result = await execute(fake, lifecycleEventForDashboardAgentStatus("active"));
    expect(result).toMatchObject({
      kind: "rejected",
      transition: { reason: "CONVERSATION_RESOLVED" },
    });
    expect(fake.rows()[0]).toEqual(resolved);
  });

  it("assigns a human and unassigns to a safe paused state", async () => {
    const fake = createStore([row()]);
    const assigned = await execute(fake, { type: "assign_human" }, {
      additionalUpdates: { assignedMembershipId: "membership-1", needsHuman: true },
    });
    expect(assigned.kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({
      assignedMembershipId: "membership-1",
      needsHuman: true,
      lifecycleState: "open",
      aiSubstate: "human_controlled",
      status: "open",
      agentStatus: "human",
    });

    const unassigned = await execute(fake, { type: "unassign" }, {
      additionalUpdates: { assignedMembershipId: null, needsHuman: false },
    });
    expect(unassigned.kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({
      assignedMembershipId: null,
      needsHuman: false,
      lifecycleState: "open",
      aiSubstate: "ai_paused",
      status: "open",
      agentStatus: "paused",
    });
  });

  it("pauses and resumes AI through dashboard events", async () => {
    const fake = createStore([row()]);
    expect((await execute(fake, lifecycleEventForDashboardAgentStatus("paused"))).kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({ aiSubstate: "ai_paused", agentStatus: "paused" });

    expect((await execute(fake, lifecycleEventForDashboardAgentStatus("active"))).kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({ aiSubstate: "ai_active", agentStatus: "active" });
  });

  it("normalizes legacy dashboard-only bot and closed statuses to lifecycle projections", async () => {
    const botRow = row();
    const botEvent = lifecycleEventForDashboardStatus(botRow, "bot");
    const botPlan = planConversationLifecycleTransition(botRow, botEvent, { unifiedLifecycleEnabled: true });
    expect(botPlan.updates).toMatchObject({ lifecycleState: "pending", status: "pending" });

    const resolved = row({ lifecycleState: "resolved", aiSubstate: "ai_paused", status: "resolved", agentStatus: "paused" });
    const closedEvent = lifecycleEventForDashboardStatus(resolved, "closed");
    const closedPlan = planConversationLifecycleTransition(resolved, closedEvent, { unifiedLifecycleEnabled: true });
    expect(closedPlan.transition?.outcome).toBe("noop");
    expect(closedPlan.projection).toEqual({ status: "resolved", agentStatus: "paused" });
  });

  it("resolves and reopens while preserving AI state", async () => {
    const fake = createStore([row({ agentStatus: "paused" })]);
    const resolvedEvent = lifecycleEventForDashboardStatus(fake.rows()[0], "resolved");
    expect((await execute(fake, resolvedEvent)).kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({
      lifecycleState: "resolved",
      aiSubstate: "ai_paused",
      status: "resolved",
      agentStatus: "paused",
    });

    const reopenEvent = lifecycleEventForDashboardStatus(fake.rows()[0], "open");
    expect((await execute(fake, reopenEvent)).kind).toBe("written");
    expect(fake.rows()[0]).toMatchObject({ lifecycleState: "open", status: "open", aiSubstate: "ai_paused" });
  });


  it("publishes reactivation only for a fresh inbound message and a reply-eligible lifecycle", () => {
    const active = row({ lifecycleState: "open", aiSubstate: "ai_active" });
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      lifecycleChanged: true,
      conversation: active,
      lastMessageDirection: "inbound",
    })).toBe(true);
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      lifecycleChanged: true,
      conversation: active,
      lastMessageDirection: "outbound",
    })).toBe(false);
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      lifecycleChanged: true,
      conversation: row({ lifecycleState: "resolved", aiSubstate: "ai_active" }),
      lastMessageDirection: "inbound",
    })).toBe(false);
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      lifecycleChanged: false,
      conversation: active,
      lastMessageDirection: "inbound",
    })).toBe(false);
  });

  it("creates one reactivation event only for a real transition", async () => {
    const fake = createStore([row({ agentStatus: "paused" })]);
    const event = lifecycleEventForDashboardAgentStatus("active");

    const first = await execute(fake, event, {
      onWritten: async () => { fake.addEvent("message.received"); },
    });
    expect(first.kind).toBe("written");
    expect(fake.events()).toEqual(["message.received"]);

    const second = await execute(fake, event, {
      onWritten: async () => { fake.addEvent("message.received"); },
    });
    expect(second.kind).toBe("noop");
    expect(fake.events()).toEqual(["message.received"]);
  });

  it("rejects an illegal transition without a partial write", async () => {
    const original = row({
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });
    const fake = createStore([original]);
    const result = await execute(fake, { type: "set_lifecycle", target: "new" }, {
      additionalUpdates: { status: "new", agentStatus: "paused" },
    });

    expect(result).toMatchObject({
      kind: "rejected",
      transition: { reason: "INVALID_LIFECYCLE_TRANSITION" },
    });
    expect(fake.rows()[0]).toEqual(original);
  });

  it("isolates writes by workspace", async () => {
    const otherWorkspace = row({ workspaceId: "workspace-2" });
    const fake = createStore([otherWorkspace]);
    const result = await execute(fake, { type: "pause_ai" }, { workspaceId: "workspace-1" });

    expect(result.kind).toBe("not_found");
    expect(fake.rows()[0]).toEqual(otherWorkspace);
  });

  it("rolls back the lifecycle row and event when any transaction step fails", async () => {
    const original = row({ agentStatus: "paused" });
    const fake = createStore([original]);

    await expect(execute(fake, { type: "resume_ai" }, {
      onWritten: async () => {
        fake.addEvent("message.received");
        throw new Error("domain event insert failed");
      },
    })).rejects.toThrow("domain event insert failed");

    expect(fake.rows()[0]).toEqual(original);
    expect(fake.events()).toEqual([]);
  });

  it("uses legacy null fallback without backfilling unrelated rows", async () => {
    const target = row({ id: "conversation-1", lifecycleState: null, aiSubstate: null, agentStatus: "paused" });
    const untouched = row({ id: "conversation-2", lifecycleState: null, aiSubstate: null, agentStatus: "paused" });
    const fake = createStore([target, untouched]);

    await execute(fake, { type: "resume_ai" });
    expect(fake.rows()[0]).toMatchObject({ lifecycleState: "open", aiSubstate: "ai_active" });
    expect(fake.rows()[1]).toEqual(untouched);
  });
});
