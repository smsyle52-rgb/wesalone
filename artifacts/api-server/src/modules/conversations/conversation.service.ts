import { and, eq } from "drizzle-orm";
import { conversationsTable, db } from "@workspace/db";
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

export type DashboardConversationStatus = LegacyConversationStatus;
export type DashboardAgentStatus = LegacyAgentStatus;
export type CompatibilityLifecycleRecord = ConversationLifecycleRecord & Readonly<{
  agentPausedUntil?: Date | string | null;
}>;
export type CanonicalDashboardStatus = Exclude<DashboardConversationStatus, "bot" | "closed">;

export function canonicalDashboardStatus(status: DashboardConversationStatus): CanonicalDashboardStatus {
  if (status === "bot") return "pending";
  if (status === "closed") return "resolved";
  return status;
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function hasActiveAgentPause(record: CompatibilityLifecycleRecord, now: Date): boolean {
  const pausedUntil = timestamp(record.agentPausedUntil);
  return pausedUntil !== null && pausedUntil > now.getTime();
}

/**
 * Conservative coexistence policy: while old and unified writers overlap, any
 * restrictive legacy or unified signal wins over a conflicting permissive one.
 */
export function normalizeConversationLifecycleForCoexistence(
  record: CompatibilityLifecycleRecord,
  now: Date = new Date(),
): NormalizedConversationLifecycle {
  const normalized = normalizeConversationLifecycle(record);
  const lifecycleState = record.status === "resolved" || record.status === "closed"
    ? "resolved"
    : record.status === "snoozed"
      ? "snoozed"
      : normalized.state.lifecycleState;

  const aiSubstate = normalized.state.aiSubstate === "ai_blocked"
    ? "ai_blocked"
    : record.needsHuman || record.assignedMembershipId || record.agentStatus === "human"
      || normalized.state.aiSubstate === "human_controlled"
      ? "human_controlled"
      : record.agentStatus === "paused" || hasActiveAgentPause(record, now)
        || normalized.state.aiSubstate === "ai_paused"
        ? "ai_paused"
        : "ai_active";

  return {
    state: { lifecycleState, aiSubstate },
    source: normalized.source,
  };
}

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
  record: CompatibilityLifecycleRecord,
  event: LifecycleEvent,
  options: Readonly<{ unifiedLifecycleEnabled: boolean }>,
): ConversationLifecyclePlan {
  const normalized = options.unifiedLifecycleEnabled
    ? normalizeConversationLifecycleForCoexistence(record)
    : normalizeConversationLifecycle(record);

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
    updates: lifecycleWriteValues(transition),
    projection: transition.projection,
  };
}

export function lifecycleWriteValues(
  transition: Exclude<LifecycleTransitionResult, { outcome: "rejected" }>,
): Readonly<{
  lifecycleState: ConversationLifecycleState["lifecycleState"];
  aiSubstate: ConversationLifecycleState["aiSubstate"];
  status: LegacyConversationStatus;
  agentStatus: LegacyAgentStatus;
}> {
  return {
    lifecycleState: transition.next.lifecycleState,
    aiSubstate: transition.next.aiSubstate,
    status: transition.projection.status,
    agentStatus: transition.projection.agentStatus,
  };
}

export function lifecycleEventForDashboardStatus(
  record: CompatibilityLifecycleRecord,
  requestedStatus: DashboardConversationStatus,
): LifecycleEvent {
  const current = normalizeConversationLifecycleForCoexistence(record).state.lifecycleState;
  const canonicalStatus = canonicalDashboardStatus(requestedStatus);

  if (canonicalStatus === "resolved") {
    return { type: "resolve", reason: `dashboard_status:${requestedStatus}` };
  }
  if (canonicalStatus === "open") {
    return current === "resolved"
      ? { type: "reopen", reason: "dashboard_status:open" }
      : { type: "set_lifecycle", target: "open", reason: "dashboard_status:open" };
  }
  return {
    type: "set_lifecycle",
    target: canonicalStatus,
    reason: `dashboard_status:${requestedStatus}`,
  };
}

export function lifecycleEventForDashboardAgentStatus(status: DashboardAgentStatus): LifecycleEvent {
  switch (status) {
    case "active":
      return { type: "reactivate_agent", reason: "dashboard_agent_status:active" };
    case "paused":
      return { type: "pause_ai", reason: "dashboard_agent_status:paused" };
    case "human":
      return { type: "handoff", reason: "dashboard_agent_status:human" };
  }
}

export function canUnifiedAgentReply(
  record: CompatibilityLifecycleRecord,
  now: Date = new Date(),
): boolean {
  const { state } = normalizeConversationLifecycleForCoexistence(record, now);
  return state.aiSubstate === "ai_active"
    && state.lifecycleState !== "resolved"
    && state.lifecycleState !== "snoozed";
}

export function wasAgentReactivationNeeded(
  record: CompatibilityLifecycleRecord,
): boolean {
  return record.aiSubstate !== "ai_active"
    || record.agentStatus !== "active"
    || Boolean(record.needsHuman)
    || Boolean(record.assignedMembershipId)
    || record.agentPausedUntil !== null && record.agentPausedUntil !== undefined;
}

export function shouldPublishAgentReactivationEvent(input: Readonly<{
  requestedStatus: DashboardAgentStatus;
  previous?: CompatibilityLifecycleRecord;
  lifecycleChanged?: boolean;
  conversation: CompatibilityLifecycleRecord;
  lastMessageDirection: string | null | undefined;
  now?: Date;
}>): boolean {
  const now = input.now ?? new Date();
  const neededBefore = input.previous
    ? wasAgentReactivationNeeded(input.previous)
    : Boolean(input.lifecycleChanged);

  return input.requestedStatus === "active"
    && neededBefore
    && input.lastMessageDirection === "inbound"
    && canUnifiedAgentReply(input.conversation, now);
}

export type AtomicLifecycleStore<TTransaction, TRow extends CompatibilityLifecycleRecord> = Readonly<{
  transaction<TResult>(callback: (transaction: TTransaction) => Promise<TResult>): Promise<TResult>;
  loadForUpdate(
    transaction: TTransaction,
    input: Readonly<{ workspaceId: string; conversationId: string }>,
  ): Promise<TRow | null>;
  write(
    transaction: TTransaction,
    input: Readonly<{
      workspaceId: string;
      conversationId: string;
      updates: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<TRow | null>;
}>;

export type AtomicLifecycleResult<TRow extends CompatibilityLifecycleRecord> =
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "disabled";
      current: TRow;
      plan: ConversationLifecyclePlan;
    }>
  | Readonly<{
      kind: "rejected";
      current: TRow;
      plan: ConversationLifecyclePlan;
      transition: Extract<LifecycleTransitionResult, { outcome: "rejected" }>;
    }>
  | Readonly<{
      kind: "noop";
      conversation: TRow;
      plan: ConversationLifecyclePlan;
      transition: Extract<LifecycleTransitionResult, { outcome: "noop" }>;
    }>
  | Readonly<{
      kind: "written";
      conversation: TRow;
      previous: TRow;
      plan: ConversationLifecyclePlan;
      transition: Exclude<LifecycleTransitionResult, { outcome: "rejected" }>;
      lifecycleChanged: boolean;
    }>;

export type AtomicLifecycleOperation<TTransaction, TRow extends CompatibilityLifecycleRecord> = Readonly<{
  workspaceId: string;
  conversationId: string;
  event: LifecycleEvent;
  unifiedLifecycleEnabled: boolean;
  additionalUpdates?: (
    current: TRow,
    plan: ConversationLifecyclePlan,
  ) => Readonly<Record<string, unknown>>;
  shouldWriteNoop?: (
    current: TRow,
    plan: ConversationLifecyclePlan,
  ) => boolean;
  onWritten?: (context: Readonly<{
    transaction: TTransaction;
    previous: TRow;
    conversation: TRow;
    plan: ConversationLifecyclePlan;
    lifecycleChanged: boolean;
  }>) => Promise<void>;
}>;

export async function executeAtomicConversationLifecycleTransition<
  TTransaction,
  TRow extends CompatibilityLifecycleRecord,
>(
  store: AtomicLifecycleStore<TTransaction, TRow>,
  operation: AtomicLifecycleOperation<TTransaction, TRow>,
): Promise<AtomicLifecycleResult<TRow>> {
  return store.transaction(async (transaction) => {
    const current = await store.loadForUpdate(transaction, {
      workspaceId: operation.workspaceId,
      conversationId: operation.conversationId,
    });
    if (!current) return { kind: "not_found" };

    const plan = planConversationLifecycleTransition(current, operation.event, {
      unifiedLifecycleEnabled: operation.unifiedLifecycleEnabled,
    });
    if (!plan.enabled || !plan.transition) {
      return { kind: "disabled", current, plan };
    }
    if (plan.transition.outcome === "rejected") {
      return { kind: "rejected", current, plan, transition: plan.transition };
    }

    const shouldWriteNoop = plan.transition.outcome === "noop"
      && (operation.shouldWriteNoop?.(current, plan) ?? false);
    if (plan.transition.outcome === "noop" && !shouldWriteNoop) {
      return { kind: "noop", conversation: current, plan, transition: plan.transition };
    }

    const supplemental = operation.additionalUpdates?.(current, plan) ?? {};
    const lifecycleValues = lifecycleWriteValues(plan.transition);
    const conversation = await store.write(transaction, {
      workspaceId: operation.workspaceId,
      conversationId: operation.conversationId,
      updates: {
        ...supplemental,
        ...lifecycleValues,
      },
    });
    if (!conversation) {
      throw new Error("Lifecycle write lost its workspace-scoped conversation row");
    }

    const lifecycleChanged = plan.transition.outcome === "applied";
    await operation.onWritten?.({
      transaction,
      previous: current,
      conversation,
      plan,
      lifecycleChanged,
    });

    return {
      kind: "written",
      conversation,
      previous: current,
      plan,
      transition: plan.transition,
      lifecycleChanged,
    };
  });
}

type ConversationRow = typeof conversationsTable.$inferSelect;
export type ConversationLifecycleDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const drizzleLifecycleStore: AtomicLifecycleStore<ConversationLifecycleDbTransaction, ConversationRow> = {
  transaction: (callback) => db.transaction(callback),
  loadForUpdate: async (transaction, input) => {
    const [conversation] = await transaction.select()
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.id, input.conversationId),
        eq(conversationsTable.workspaceId, input.workspaceId),
      ))
      .for("update")
      .limit(1);
    return conversation ?? null;
  },
  write: async (transaction, input) => {
    const [conversation] = await transaction.update(conversationsTable)
      .set(input.updates as Partial<typeof conversationsTable.$inferInsert>)
      .where(and(
        eq(conversationsTable.id, input.conversationId),
        eq(conversationsTable.workspaceId, input.workspaceId),
      ))
      .returning();
    return conversation ?? null;
  },
};

export function applyConversationLifecycleEventAtomic(
  operation: AtomicLifecycleOperation<ConversationLifecycleDbTransaction, ConversationRow>,
): Promise<AtomicLifecycleResult<ConversationRow>> {
  return executeAtomicConversationLifecycleTransition(drizzleLifecycleStore, operation);
}
