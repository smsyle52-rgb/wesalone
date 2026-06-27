/**
 * Pure conversation lifecycle foundation.
 *
 * W3-T1A deliberately has no database, HTTP, worker, or event-bus side effects.
 * Production writers continue using the legacy status/agent_status fields until
 * later rollout phases explicitly adopt this engine behind UNIFIED_LIFECYCLE.
 */

export const LIFECYCLE_STATES = ["new", "open", "pending", "resolved", "snoozed"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const AI_SUBSTATES = ["ai_active", "ai_paused", "human_controlled", "ai_blocked"] as const;
export type AiSubstate = (typeof AI_SUBSTATES)[number];

export const LIFECYCLE_EVENTS = [
  "assign_human",
  "pause_ai",
  "resume_ai",
  "escalate",
  "resolve",
  "reopen",
  "inbound_reactivation",
  "handoff",
  "unassign",
] as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENTS)[number];

export type LegacyConversationStatus =
  | "new"
  | "open"
  | "pending"
  | "snoozed"
  | "bot"
  | "resolved"
  | "closed";

export type LegacyAgentStatus = "active" | "paused" | "human";

export type ConversationLifecycleState = Readonly<{
  lifecycleState: LifecycleState;
  aiSubstate: AiSubstate;
}>;

export type ConversationLifecycleSource = "native" | "legacy_fallback" | "mixed_fallback";

export type ConversationLifecycleRecord = Readonly<{
  lifecycleState?: string | null;
  aiSubstate?: string | null;
  status?: string | null;
  agentStatus?: string | null;
  needsHuman?: boolean | null;
  assignedMembershipId?: string | null;
}>;

export type LifecycleEvent = Readonly<{
  type: LifecycleEventType;
  reason?: string;
}>;

export type LifecycleProjection = Readonly<{
  status: LegacyConversationStatus;
  agentStatus: LegacyAgentStatus;
}>;

export type LifecycleDomainEvent = Readonly<{
  type:
    | "conversation.assigned"
    | "conversation.ai_paused"
    | "conversation.ai_resumed"
    | "conversation.needs_human"
    | "conversation.resolved"
    | "conversation.reopened"
    | "conversation.reactivated"
    | "conversation.unassigned";
  inboundClass: boolean;
}>;

export type LifecycleTransitionResult =
  | Readonly<{
      outcome: "applied";
      event: LifecycleEvent;
      previous: ConversationLifecycleState;
      next: ConversationLifecycleState;
      projection: LifecycleProjection;
      domainEvents: readonly LifecycleDomainEvent[];
    }>
  | Readonly<{
      outcome: "noop";
      event: LifecycleEvent;
      previous: ConversationLifecycleState;
      next: ConversationLifecycleState;
      projection: LifecycleProjection;
      domainEvents: readonly [];
      reason: "ALREADY_IN_TARGET_STATE";
    }>
  | Readonly<{
      outcome: "rejected";
      event: LifecycleEvent;
      previous: ConversationLifecycleState;
      next: ConversationLifecycleState;
      projection: LifecycleProjection;
      domainEvents: readonly [];
      reason:
        | "CONVERSATION_RESOLVED"
        | "CONVERSATION_SNOOZED"
        | "AI_CONTROLLED_BY_HUMAN"
        | "AI_BLOCKED"
        | "NOT_RESOLVED"
        | "NOT_HUMAN_CONTROLLED";
    }>;

export type NormalizedConversationLifecycle = Readonly<{
  state: ConversationLifecycleState;
  source: ConversationLifecycleSource;
}>;

const LIFECYCLE_STATE_SET = new Set<string>(LIFECYCLE_STATES);
const AI_SUBSTATE_SET = new Set<string>(AI_SUBSTATES);

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && LIFECYCLE_STATE_SET.has(value);
}

export function isAiSubstate(value: unknown): value is AiSubstate {
  return typeof value === "string" && AI_SUBSTATE_SET.has(value);
}

export function lifecycleFromLegacyStatus(value: string | null | undefined): LifecycleState {
  switch (value) {
    case "new":
      return "new";
    case "pending":
    case "bot":
      return "pending";
    case "snoozed":
      return "snoozed";
    case "resolved":
    case "closed":
      return "resolved";
    case "open":
    default:
      return "open";
  }
}

export function aiSubstateFromLegacy(record: ConversationLifecycleRecord): AiSubstate {
  if (record.needsHuman || record.assignedMembershipId) return "human_controlled";

  switch (record.agentStatus) {
    case "paused":
      return "ai_paused";
    case "human":
      return "human_controlled";
    case "active":
    default:
      return "ai_active";
  }
}

export function normalizeConversationLifecycle(
  record: ConversationLifecycleRecord,
): NormalizedConversationLifecycle {
  const hasNativeLifecycle = isLifecycleState(record.lifecycleState);
  const hasNativeAi = isAiSubstate(record.aiSubstate);

  const state: ConversationLifecycleState = {
    lifecycleState: hasNativeLifecycle
      ? record.lifecycleState
      : lifecycleFromLegacyStatus(record.status),
    aiSubstate: hasNativeAi ? record.aiSubstate : aiSubstateFromLegacy(record),
  };

  const source: ConversationLifecycleSource = hasNativeLifecycle && hasNativeAi
    ? "native"
    : !hasNativeLifecycle && !hasNativeAi
      ? "legacy_fallback"
      : "mixed_fallback";

  return { state, source };
}

export function projectLifecycleToLegacy(state: ConversationLifecycleState): LifecycleProjection {
  const status: LegacyConversationStatus = state.lifecycleState;
  const agentStatus: LegacyAgentStatus = state.aiSubstate === "ai_active"
    ? "active"
    : state.aiSubstate === "ai_paused"
      ? "paused"
      : "human";

  return { status, agentStatus };
}

function sameState(left: ConversationLifecycleState, right: ConversationLifecycleState): boolean {
  return left.lifecycleState === right.lifecycleState && left.aiSubstate === right.aiSubstate;
}

function domainEventFor(event: LifecycleEventType): LifecycleDomainEvent {
  switch (event) {
    case "assign_human":
      return { type: "conversation.assigned", inboundClass: false };
    case "pause_ai":
      return { type: "conversation.ai_paused", inboundClass: false };
    case "resume_ai":
      return { type: "conversation.ai_resumed", inboundClass: false };
    case "resolve":
      return { type: "conversation.resolved", inboundClass: false };
    case "reopen":
      return { type: "conversation.reopened", inboundClass: false };
    case "inbound_reactivation":
      return { type: "conversation.reactivated", inboundClass: true };
    case "unassign":
      return { type: "conversation.unassigned", inboundClass: false };
    case "escalate":
    case "handoff":
      return { type: "conversation.needs_human", inboundClass: false };
  }
}

function applied(
  previous: ConversationLifecycleState,
  next: ConversationLifecycleState,
  event: LifecycleEvent,
): LifecycleTransitionResult {
  if (sameState(previous, next)) {
    return {
      outcome: "noop",
      event,
      previous,
      next: previous,
      projection: projectLifecycleToLegacy(previous),
      domainEvents: [],
      reason: "ALREADY_IN_TARGET_STATE",
    };
  }

  return {
    outcome: "applied",
    event,
    previous,
    next,
    projection: projectLifecycleToLegacy(next),
    domainEvents: [domainEventFor(event.type)],
  };
}

function rejected(
  state: ConversationLifecycleState,
  event: LifecycleEvent,
  reason: Extract<LifecycleTransitionResult, { outcome: "rejected" }>["reason"],
): LifecycleTransitionResult {
  return {
    outcome: "rejected",
    event,
    previous: state,
    next: state,
    projection: projectLifecycleToLegacy(state),
    domainEvents: [],
    reason,
  };
}

function rejectWhenInactiveLifecycle(
  state: ConversationLifecycleState,
  event: LifecycleEvent,
): LifecycleTransitionResult | null {
  if (state.lifecycleState === "resolved") return rejected(state, event, "CONVERSATION_RESOLVED");
  if (state.lifecycleState === "snoozed") return rejected(state, event, "CONVERSATION_SNOOZED");
  return null;
}

/**
 * Evaluate one lifecycle event. This function is deterministic and side-effect free.
 * Re-applying an event that already reached its target returns a noop and emits no event.
 */
export function transitionConversationLifecycle(
  state: ConversationLifecycleState,
  event: LifecycleEvent,
): LifecycleTransitionResult {
  switch (event.type) {
    case "assign_human": {
      if (state.lifecycleState === "resolved") return rejected(state, event, "CONVERSATION_RESOLVED");
      return applied(state, { lifecycleState: "open", aiSubstate: "human_controlled" }, event);
    }

    case "pause_ai": {
      const inactive = rejectWhenInactiveLifecycle(state, event);
      if (inactive) return inactive;
      if (state.aiSubstate === "human_controlled") return rejected(state, event, "AI_CONTROLLED_BY_HUMAN");
      if (state.aiSubstate === "ai_blocked") return rejected(state, event, "AI_BLOCKED");
      return applied(state, { ...state, aiSubstate: "ai_paused" }, event);
    }

    case "resume_ai": {
      const inactive = rejectWhenInactiveLifecycle(state, event);
      if (inactive) return inactive;
      if (state.aiSubstate === "human_controlled") return rejected(state, event, "AI_CONTROLLED_BY_HUMAN");
      if (state.aiSubstate === "ai_blocked") return rejected(state, event, "AI_BLOCKED");
      return applied(state, { ...state, aiSubstate: "ai_active" }, event);
    }

    case "escalate":
    case "handoff": {
      if (state.lifecycleState === "resolved") return rejected(state, event, "CONVERSATION_RESOLVED");
      return applied(state, { lifecycleState: "open", aiSubstate: "human_controlled" }, event);
    }

    case "resolve":
      return applied(state, { ...state, lifecycleState: "resolved" }, event);

    case "reopen": {
      if (state.lifecycleState === "open") {
        return applied(state, state, event);
      }
      if (state.lifecycleState !== "resolved") return rejected(state, event, "NOT_RESOLVED");
      return applied(state, { ...state, lifecycleState: "open" }, event);
    }

    case "inbound_reactivation": {
      const lifecycleState: LifecycleState = state.lifecycleState === "resolved"
        || state.lifecycleState === "snoozed"
        || state.lifecycleState === "pending"
        || state.lifecycleState === "new"
        ? "open"
        : state.lifecycleState;
      const aiSubstate: AiSubstate = state.aiSubstate === "ai_paused" ? "ai_active" : state.aiSubstate;
      return applied(state, { lifecycleState, aiSubstate }, event);
    }

    case "unassign": {
      if (state.lifecycleState === "resolved") return rejected(state, event, "CONVERSATION_RESOLVED");
      if (state.aiSubstate === "ai_paused" && state.lifecycleState === "open") {
        return applied(state, state, event);
      }
      if (state.aiSubstate !== "human_controlled") return rejected(state, event, "NOT_HUMAN_CONTROLLED");
      // Safe default: removing a human does not silently resume autonomous sending.
      return applied(state, { lifecycleState: "open", aiSubstate: "ai_paused" }, event);
    }
  }
}
