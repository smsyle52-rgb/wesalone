import {
  normalizeConversationLifecycle,
  projectLifecycleToLegacy,
  transitionConversationLifecycle,
  type ConversationLifecycleRecord,
  type ConversationLifecycleState,
  type LegacyAgentStatus,
  type LegacyConversationStatus,
  type LifecycleEvent,
  type LifecycleProjection,
  type LifecycleTransitionResult,
  type NormalizedConversationLifecycle,
} from "./lifecycle";

/**
 * A side-effect-free planning layer for W3-T1A.
 *
 * It intentionally performs no DB writes. Later phases can pass the returned
 * updates to their existing writer only after UNIFIED_LIFECYCLE is enabled.
 */
export type ConversationLifecyclePlan = Readonly<{
  enabled: boolean;
  normalized: NormalizedConversationLifecycle;
  transition: LifecycleTransitionResult | null;
  updates: Readonly<Partial<{
    lifecycleState: ConversationLifecycleState["lifecycleState"];
    aiSubstate: ConversationLifecycleState["aiSubstate"];
    status: LegacyConversationStatus;
    agentStatus: LegacyAgentStatus;
  }>>;
  projection: LifecycleProjection;
}>;

function preserveLegacyProjection(record: ConversationLifecycleRecord): LifecycleProjection {
  const normalized = normalizeConversationLifecycle(record);
  const fallback = projectLifecycleToLegacy(normalized.state);

  return {
    status: isLegacyStatus(record.status) ? record.status : fallback.status,
    agentStatus: isLegacyAgentStatus(record.agentStatus) ? record.agentStatus : fallback.agentStatus,
  };
}

function isLegacyStatus(value: unknown): value is LegacyConversationStatus {
  return value === "new"
    || value === "open"
    || value === "pending"
    || value === "snoozed"
    || value === "bot"
    || value === "resolved"
    || value === "closed";
}

function isLegacyAgentStatus(value: unknown): value is LegacyAgentStatus {
  return value === "active" || value === "paused" || value === "human";
}

export function planConversationLifecycleTransition(
  record: ConversationLifecycleRecord,
  event: LifecycleEvent,
  options: Readonly<{ unifiedLifecycleEnabled: boolean }>,
): ConversationLifecyclePlan {
  const normalized = normalizeConversationLifecycle(record);

  if (!options.unifiedLifecycleEnabled) {
    return {
      enabled: false,
      normalized,
      transition: null,
      updates: {},
      projection: preserveLegacyProjection(record),
    };
  }

  const transition = transitionConversationLifecycle(normalized.state, event);
  if (transition.outcome !== "applied") {
    return {
      enabled: true,
      normalized,
      transition,
      updates: {},
      projection: transition.projection,
    };
  }

  return {
    enabled: true,
    normalized,
    transition,
    updates: {
      lifecycleState: transition.next.lifecycleState,
      aiSubstate: transition.next.aiSubstate,
      status: transition.projection.status,
      agentStatus: transition.projection.agentStatus,
    },
    projection: transition.projection,
  };
}
