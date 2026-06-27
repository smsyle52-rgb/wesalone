import { describe, expect, it } from "vitest";
import {
  canUnifiedAgentReply,
  canonicalDashboardStatus,
  normalizeConversationLifecycleForCoexistence,
  shouldPublishAgentReactivationEvent,
  wasAgentReactivationNeeded,
} from "../modules/conversations/conversation.service";

const NOW = new Date("2026-06-27T12:00:00.000Z");

describe("W3-T1B.1 canonical aliases", () => {
  it("maps bot to pending and closed to resolved", () => {
    expect(canonicalDashboardStatus("bot")).toBe("pending");
    expect(canonicalDashboardStatus("closed")).toBe("resolved");
  });
});

describe("W3-T1B.1 conservative coexistence", () => {
  it.each([
    [{ aiSubstate: "ai_active", agentStatus: "active", needsHuman: true }, "human_controlled"],
    [{ aiSubstate: "ai_active", agentStatus: "active", assignedMembershipId: "membership-1" }, "human_controlled"],
    [{ aiSubstate: "ai_active", agentStatus: "human" }, "human_controlled"],
    [{ aiSubstate: "ai_active", agentStatus: "paused" }, "ai_paused"],
    [{ aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: "2026-06-27T12:30:00.000Z" }, "ai_paused"],
  ])("chooses the safer AI state for %o", (record, expected) => {
    expect(normalizeConversationLifecycleForCoexistence({
      status: "open",
      lifecycleState: "open",
      ...record,
    }, NOW).state.aiSubstate).toBe(expected);
  });

  it.each(["resolved", "closed", "snoozed"] as const)(
    "lets restrictive legacy status %s override stale open lifecycle",
    (status) => {
      const record = { status, lifecycleState: "open", aiSubstate: "ai_active", agentStatus: "active" };
      const normalized = normalizeConversationLifecycleForCoexistence(record, NOW);
      expect(normalized.state.lifecycleState).toBe(status === "snoozed" ? "snoozed" : "resolved");
      expect(canUnifiedAgentReply(record, NOW)).toBe(false);
    },
  );

  it("allows reply after an expired pause when all other fields are active", () => {
    expect(canUnifiedAgentReply({
      status: "open",
      lifecycleState: "open",
      aiSubstate: "ai_active",
      agentStatus: "active",
      agentPausedUntil: "2026-06-27T11:59:00.000Z",
    }, NOW)).toBe(true);
  });
});

describe("W3-T1B.1 reactivation event", () => {
  it.each([
    { aiSubstate: "ai_active", agentStatus: "active", needsHuman: true },
    { aiSubstate: "ai_active", agentStatus: "paused", needsHuman: false },
    { aiSubstate: null, lifecycleState: null, agentStatus: "paused", needsHuman: false },
    { aiSubstate: "ai_active", agentStatus: "active", agentPausedUntil: "2026-06-27T11:00:00.000Z" },
  ])("recognizes prior reactivation reason %o", (previous) => {
    const before = { status: "open", lifecycleState: "open", ...previous };
    const after = {
      status: "open", lifecycleState: "open", aiSubstate: "ai_active", agentStatus: "active",
      needsHuman: false, assignedMembershipId: null, agentPausedUntil: null,
    };
    expect(wasAgentReactivationNeeded(before)).toBe(true);
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      previous: before,
      conversation: after,
      lastMessageDirection: "inbound",
      now: NOW,
    })).toBe(true);
  });

  it("does not repeat after the record is fully active", () => {
    const active = {
      status: "open", lifecycleState: "open", aiSubstate: "ai_active", agentStatus: "active",
      needsHuman: false, assignedMembershipId: null, agentPausedUntil: null,
    } as const;
    expect(wasAgentReactivationNeeded(active)).toBe(false);
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      previous: active,
      conversation: active,
      lastMessageDirection: "inbound",
      now: NOW,
    })).toBe(false);
  });

  it.each(["resolved", "snoozed"] as const)("does not emit for %s after update", (status) => {
    expect(shouldPublishAgentReactivationEvent({
      requestedStatus: "active",
      previous: { status: "open", lifecycleState: "open", aiSubstate: "ai_paused", agentStatus: "paused" },
      conversation: { status, lifecycleState: status, aiSubstate: "ai_active", agentStatus: "active" },
      lastMessageDirection: "inbound",
      now: NOW,
    })).toBe(false);
  });
});
