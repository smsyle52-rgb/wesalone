import { describe, expect, it } from "vitest";
import {
  normalizeConversationLifecycle,
  projectLifecycleToLegacy,
  transitionConversationLifecycle,
  type ConversationLifecycleState,
  type LifecycleEventType,
} from "../modules/conversations/lifecycle";
import { planConversationLifecycleTransition } from "../modules/conversations/conversation.service";

const activeOpen: ConversationLifecycleState = {
  lifecycleState: "open",
  aiSubstate: "ai_active",
};

function transition(state: ConversationLifecycleState, type: LifecycleEventType) {
  return transitionConversationLifecycle(state, { type });
}

describe("conversation lifecycle projections", () => {
  it.each([
    [{ lifecycleState: "new", aiSubstate: "ai_active" }, { status: "new", agentStatus: "active" }],
    [{ lifecycleState: "open", aiSubstate: "ai_paused" }, { status: "open", agentStatus: "paused" }],
    [{ lifecycleState: "pending", aiSubstate: "ai_active" }, { status: "pending", agentStatus: "active" }],
    [{ lifecycleState: "resolved", aiSubstate: "human_controlled" }, { status: "resolved", agentStatus: "human" }],
    [{ lifecycleState: "snoozed", aiSubstate: "ai_blocked" }, { status: "snoozed", agentStatus: "human" }],
  ] as const)("projects %o to legacy values", (state, expected) => {
    expect(projectLifecycleToLegacy(state)).toEqual(expected);
  });
});

describe("legacy fallback", () => {
  it.each([
    ["new", "new"],
    ["open", "open"],
    ["pending", "pending"],
    ["bot", "pending"],
    ["snoozed", "snoozed"],
    ["resolved", "resolved"],
    ["closed", "resolved"],
  ])("maps legacy status %s to lifecycle %s", (status, expected) => {
    const normalized = normalizeConversationLifecycle({
      lifecycleState: null,
      aiSubstate: null,
      status,
      agentStatus: "active",
    });
    expect(normalized.state.lifecycleState).toBe(expected);
    expect(normalized.source).toBe("legacy_fallback");
  });

  it("maps paused legacy AI to ai_paused", () => {
    expect(normalizeConversationLifecycle({ status: "open", agentStatus: "paused" }).state.aiSubstate)
      .toBe("ai_paused");
  });

  it("treats needsHuman and an assigned membership as human controlled", () => {
    expect(normalizeConversationLifecycle({ status: "open", agentStatus: "active", needsHuman: true }).state.aiSubstate)
      .toBe("human_controlled");
    expect(normalizeConversationLifecycle({ status: "open", agentStatus: "active", assignedMembershipId: "membership-1" }).state.aiSubstate)
      .toBe("human_controlled");
  });

  it("uses native values when present and falls back only for a missing axis", () => {
    const normalized = normalizeConversationLifecycle({
      lifecycleState: "pending",
      aiSubstate: null,
      status: "closed",
      agentStatus: "paused",
    });
    expect(normalized).toEqual({
      state: { lifecycleState: "pending", aiSubstate: "ai_paused" },
      source: "mixed_fallback",
    });
  });
});

describe("legal lifecycle transitions", () => {
  it("assigns a human", () => {
    const result = transition(activeOpen, "assign_human");
    expect(result.outcome).toBe("applied");
    expect(result.next).toEqual({ lifecycleState: "open", aiSubstate: "human_controlled" });
    expect(result.domainEvents).toEqual([{ type: "conversation.assigned", inboundClass: false }]);
  });

  it("pauses and resumes AI", () => {
    const paused = transition(activeOpen, "pause_ai");
    expect(paused.outcome).toBe("applied");
    expect(paused.next.aiSubstate).toBe("ai_paused");

    const resumed = transition(paused.next, "resume_ai");
    expect(resumed.outcome).toBe("applied");
    expect(resumed.next.aiSubstate).toBe("ai_active");
  });

  it.each(["escalate", "handoff"] as const)("moves %s to human handling", (event) => {
    const result = transition(activeOpen, event);
    expect(result.outcome).toBe("applied");
    expect(result.next).toEqual({ lifecycleState: "open", aiSubstate: "human_controlled" });
    expect(result.projection.agentStatus).toBe("human");
  });

  it("resolves then reopens while preserving the AI substate", () => {
    const resolved = transition({ lifecycleState: "open", aiSubstate: "ai_paused" }, "resolve");
    expect(resolved.outcome).toBe("applied");
    expect(resolved.next).toEqual({ lifecycleState: "resolved", aiSubstate: "ai_paused" });

    const reopened = transition(resolved.next, "reopen");
    expect(reopened.outcome).toBe("applied");
    expect(reopened.next).toEqual({ lifecycleState: "open", aiSubstate: "ai_paused" });
  });

  it("reactivates a resolved paused conversation from a fresh inbound event", () => {
    const result = transition(
      { lifecycleState: "resolved", aiSubstate: "ai_paused" },
      "inbound_reactivation",
    );
    expect(result.outcome).toBe("applied");
    expect(result.next).toEqual({ lifecycleState: "open", aiSubstate: "ai_active" });
    expect(result.domainEvents).toEqual([{ type: "conversation.reactivated", inboundClass: true }]);
  });

  it("does not override human control during inbound reactivation", () => {
    const result = transition(
      { lifecycleState: "resolved", aiSubstate: "human_controlled" },
      "inbound_reactivation",
    );
    expect(result.outcome).toBe("applied");
    expect(result.next).toEqual({ lifecycleState: "open", aiSubstate: "human_controlled" });
  });

  it("unassigns to a safe paused state instead of silently resuming AI", () => {
    const result = transition(
      { lifecycleState: "open", aiSubstate: "human_controlled" },
      "unassign",
    );
    expect(result.outcome).toBe("applied");
    expect(result.next).toEqual({ lifecycleState: "open", aiSubstate: "ai_paused" });
  });
});

describe("illegal lifecycle transitions", () => {
  it.each(["assign_human", "pause_ai", "resume_ai", "escalate", "handoff", "unassign"] as const)(
    "rejects %s while resolved",
    (event) => {
      expect(transition({ lifecycleState: "resolved", aiSubstate: "ai_active" }, event)).toMatchObject({
        outcome: "rejected",
        reason: "CONVERSATION_RESOLVED",
      });
    },
  );

  it("rejects resume while human controlled", () => {
    expect(transition({ lifecycleState: "open", aiSubstate: "human_controlled" }, "resume_ai"))
      .toMatchObject({ outcome: "rejected", reason: "AI_CONTROLLED_BY_HUMAN" });
  });

  it("rejects pause and resume while AI is blocked", () => {
    expect(transition({ lifecycleState: "open", aiSubstate: "ai_blocked" }, "pause_ai"))
      .toMatchObject({ outcome: "rejected", reason: "AI_BLOCKED" });
    expect(transition({ lifecycleState: "open", aiSubstate: "ai_blocked" }, "resume_ai"))
      .toMatchObject({ outcome: "rejected", reason: "AI_BLOCKED" });
  });

  it("rejects reopen unless resolved or already open", () => {
    expect(transition({ lifecycleState: "pending", aiSubstate: "ai_active" }, "reopen"))
      .toMatchObject({ outcome: "rejected", reason: "NOT_RESOLVED" });
  });

  it("rejects unassign when no human owns the conversation", () => {
    expect(transition(activeOpen, "unassign"))
      .toMatchObject({ outcome: "rejected", reason: "NOT_HUMAN_CONTROLLED" });
  });
});

describe("idempotency and feature flag safety", () => {
  it.each([
    [{ lifecycleState: "open", aiSubstate: "ai_paused" }, "pause_ai"],
    [{ lifecycleState: "open", aiSubstate: "ai_active" }, "resume_ai"],
    [{ lifecycleState: "resolved", aiSubstate: "ai_active" }, "resolve"],
    [{ lifecycleState: "open", aiSubstate: "human_controlled" }, "handoff"],
    [{ lifecycleState: "open", aiSubstate: "ai_active" }, "inbound_reactivation"],
    [{ lifecycleState: "open", aiSubstate: "ai_paused" }, "unassign"],
  ] as const)("does not create a duplicate transition for %s", (state, event) => {
    const result = transition(state, event);
    expect(result.outcome).toBe("noop");
    expect(result.domainEvents).toEqual([]);
  });

  it("preserves exact legacy fields and produces no updates while the flag is off", () => {
    const plan = planConversationLifecycleTransition(
      { lifecycleState: null, aiSubstate: null, status: "bot", agentStatus: "paused" },
      { type: "resume_ai" },
      { unifiedLifecycleEnabled: false },
    );
    expect(plan.enabled).toBe(false);
    expect(plan.transition).toBeNull();
    expect(plan.updates).toEqual({});
    expect(plan.projection).toEqual({ status: "bot", agentStatus: "paused" });
  });

  it("returns projection updates only when enabled and applied", () => {
    const plan = planConversationLifecycleTransition(
      { lifecycleState: null, aiSubstate: null, status: "open", agentStatus: "paused" },
      { type: "resume_ai" },
      { unifiedLifecycleEnabled: true },
    );
    expect(plan.transition?.outcome).toBe("applied");
    expect(plan.updates).toEqual({
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });
  });
});
