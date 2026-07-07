import { pool } from "@workspace/db";

type MinimalLogger = {
  warn: (obj: unknown, msg?: string) => void;
};

type DomainEventRow = {
  id: string;
  workspace_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

type AutomationRow = {
  id: string;
  workspace_id: string;
  trigger: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  actions: Array<{ type: string; params: Record<string, unknown> }>;
  run_count: number;
};

type ConditionResult = Record<string, unknown> & { actual?: unknown; passed: boolean };

const batchSize = 50;
const maxAttempts = 5;

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function evaluateCondition(condition: Record<string, unknown>, payload: Record<string, unknown>): ConditionResult {
  const field = typeof condition.field === "string" ? condition.field : "";
  const operator = typeof condition.operator === "string" ? condition.operator : "exists";
  const actual = field ? getByPath(payload, field) : undefined;
  let passed = false;

  if (operator === "exists") passed = actual !== undefined && actual !== null;
  if (operator === "not_exists") passed = actual === undefined || actual === null;
  if (operator === "equals") passed = actual === condition.value;
  if (operator === "not_equals") passed = actual !== condition.value;
  if (operator === "contains") {
    passed = Array.isArray(actual)
      ? actual.includes(condition.value)
      : typeof actual === "string" && typeof condition.value === "string" && actual.includes(condition.value);
  }

  return { ...condition, actual, passed };
}

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberParam(params: Record<string, unknown>, key: string): number | null {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getPayloadId(event: DomainEventRow, key: string, fallbackEntityType?: string): string | null {
  const value = event.payload[key];
  if (typeof value === "string" && value) return value;
  if (fallbackEntityType && event.entity_type === fallbackEntityType) return event.entity_id;
  return null;
}

async function resolveMembershipId(workspaceId: string, params: Record<string, unknown>): Promise<string | null> {
  const membershipId = stringParam(params, "membership_id") ?? stringParam(params, "assignee_id");
  if (membershipId) return membershipId;

  const userId = stringParam(params, "user_id");
  if (!userId) return null;

  const result = await pool.query<{ id: string }>(
    "SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1",
    [workspaceId, userId],
  );
  return result.rows[0]?.id ?? null;
}

async function claimDomainEvents(): Promise<DomainEventRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<DomainEventRow>(
      `
      UPDATE domain_events
      SET status = 'processing'
      WHERE id IN (
        SELECT id
        FROM domain_events
        WHERE status = 'pending'
          AND next_attempt_at <= now()
          AND event_type <> 'catalog.sync.requested'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      RETURNING id, workspace_id, event_type, entity_type, entity_id, payload, attempts
      `,
      [batchSize],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function loadAutomations(event: DomainEventRow): Promise<AutomationRow[]> {
  const result = await pool.query<AutomationRow>(
    `
    SELECT id, workspace_id, trigger, conditions, actions, run_count
    FROM automations
    WHERE workspace_id = $1
      AND status = 'active'
      AND trigger->>'type' = $2
    ORDER BY created_at ASC
    `,
    [event.workspace_id, event.event_type],
  );
  return result.rows;
}

async function runAutomationAction(automation: AutomationRow, event: DomainEventRow, action: { type: string; params: Record<string, unknown> }) {
  const params = action.params ?? {};
  if (action.type === "send.template") {
    await pool.query(
      `
      INSERT INTO outbox_events (workspace_id, event_type, entity_type, entity_id, idempotency_key, payload, status, next_attempt_at)
      VALUES ($1, 'message.send.whatsapp.template', 'automation', $2, $3, $4::jsonb, 'pending', now())
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      `,
      [
        event.workspace_id,
        automation.id,
        `auto:${automation.id}:${event.id}`,
        JSON.stringify({ automationId: automation.id, domainEventId: event.id, params, triggerPayload: event.payload }),
      ],
    );
    return { type: action.type, queued: true };
  }

  if (action.type === "add.tag") {
    const tag = stringParam(params, "tag");
    const contactId = getPayloadId(event, "contactId", "contact");
    if (!tag || !contactId) return { type: action.type, skipped: "missing_contact_or_tag" };
    await pool.query(
      `
      UPDATE contacts
      SET tags = CASE WHEN NOT ($3 = ANY(tags)) THEN array_append(tags, $3) ELSE tags END,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      `,
      [event.workspace_id, contactId, tag],
    );
    return { type: action.type, contactId, tag };
  }

  if (action.type === "assign.conversation") {
    const conversationId = getPayloadId(event, "conversationId", "conversation");
    if (!conversationId) return { type: action.type, skipped: "missing_conversation" };
    const membershipId = await resolveMembershipId(event.workspace_id, params);
    const teamId = stringParam(params, "team_id");
    await pool.query(
      `
      UPDATE conversations
      SET assigned_membership_id = COALESCE($3, assigned_membership_id),
          team_id = COALESCE($4, team_id),
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      `,
      [event.workspace_id, conversationId, membershipId, teamId],
    );
    return { type: action.type, conversationId, membershipId, teamId };
  }

  if (action.type === "create.task") {
    const conversationId = getPayloadId(event, "conversationId", "conversation");
    const contactId = getPayloadId(event, "contactId", "contact");
    const dueHours = numberParam(params, "due_in_hours") ?? 24;
    const membershipId = await resolveMembershipId(event.workspace_id, params);
    const result = await pool.query<{ id: string }>(
      `
      INSERT INTO tasks (workspace_id, title, description, contact_id, conversation_id, assigned_membership_id, due_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' hours')::interval, now(), now())
      RETURNING id
      `,
      [
        event.workspace_id,
        stringParam(params, "title") ?? "مهمة من الأتمتة",
        stringParam(params, "description"),
        contactId,
        conversationId,
        membershipId,
        dueHours,
      ],
    );
    return { type: action.type, taskId: result.rows[0]?.id };
  }

  if (action.type === "create.followup") {
    const conversationId = getPayloadId(event, "conversationId", "conversation");
    const contactId = getPayloadId(event, "contactId", "contact");
    const dueHours = numberParam(params, "scheduled_in_hours") ?? 24;
    const membershipId = await resolveMembershipId(event.workspace_id, params);
    const result = await pool.query<{ id: string }>(
      `
      INSERT INTO followups (workspace_id, contact_id, conversation_id, assigned_membership_id, type, title, scheduled_at, note, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' hours')::interval, $8, now(), now())
      RETURNING id
      `,
      [
        event.workspace_id,
        contactId,
        conversationId,
        membershipId,
        stringParam(params, "type") ?? "manual",
        stringParam(params, "title"),
        dueHours,
        stringParam(params, "note"),
      ],
    );
    return { type: action.type, followupId: result.rows[0]?.id };
  }

  return { type: action.type, skipped: "unsupported_action" };
}

async function processAutomation(automation: AutomationRow, event: DomainEventRow) {
  const startedAt = new Date();
  const conditions = Array.isArray(automation.conditions) ? automation.conditions : [];
  const actions = Array.isArray(automation.actions) ? automation.actions : [];
  const evaluated = conditions.map((condition) => evaluateCondition(condition, event.payload ?? {}));
  const shouldRun = evaluated.every((condition) => condition.passed);
  const actionsExecuted = [];

  if (shouldRun) {
    for (const action of actions) {
      actionsExecuted.push(await runAutomationAction(automation, event, action));
    }
  }

  await pool.query(
    `
    INSERT INTO automation_runs (automation_id, workspace_id, status, trigger_payload, conditions_evaluated, actions_executed, started_at, finished_at)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, now())
    `,
    [
      automation.id,
      event.workspace_id,
      shouldRun ? "success" : "skipped",
      JSON.stringify({ ...event.payload, domainEventId: event.id, eventType: event.event_type }),
      JSON.stringify(evaluated),
      JSON.stringify(actionsExecuted),
      startedAt,
    ],
  );

  if (shouldRun) {
    await pool.query(
      "UPDATE automations SET run_count = run_count + 1, last_run_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2",
      [automation.id, event.workspace_id],
    );
  }
}

async function markProcessed(eventId: string): Promise<void> {
  await pool.query("UPDATE domain_events SET status = 'processed', processed_at = now() WHERE id = $1", [eventId]);
}

async function markEventFailure(event: DomainEventRow, err: unknown): Promise<void> {
  const attempts = event.attempts + 1;
  const failed = attempts >= maxAttempts;
  const errorMessage = err instanceof Error ? err.message : "Unknown automation error";
  await pool.query(
    `
    UPDATE domain_events
    SET attempts = $2,
        status = $3,
        next_attempt_at = now() + ($4 || ' seconds')::interval,
        payload = payload || jsonb_build_object('last_error', $5::text)
    WHERE id = $1
    `,
    [event.id, attempts, failed ? "failed" : "pending", Math.pow(2, attempts), errorMessage.slice(0, 500)],
  );

  if (failed) {
    await pool.query(
      `
      INSERT INTO audit_logs (workspace_id, actor_type, action, severity, entity_type, entity_id, entity_label, new_data)
      VALUES ($1, 'system', 'automation_domain_event_failed', 'high', 'domain_event', $2, $3, $4::jsonb)
      `,
      [event.workspace_id, event.id, event.event_type, JSON.stringify({ error: errorMessage.slice(0, 500), attempts })],
    );
  }
}

async function processDomainEvent(event: DomainEventRow, logger: MinimalLogger): Promise<void> {
  try {
    const automations = await loadAutomations(event);
    for (const automation of automations) {
      await processAutomation(automation, event);
    }
    await markProcessed(event.id);
  } catch (err) {
    logger.warn({ err, eventId: event.id, eventType: event.event_type }, "Automation engine event failed");
    await markEventFailure(event, err);
  }
}

// Standalone-loop entry point. Not currently started anywhere — kept for the
// pre-W5-T2 standalone-poller shape. claimDomainEvents() here has its own
// competing FOR UPDATE SKIP LOCKED query; do not start this loop *and* the
// event-dispatcher subscriber below at the same time, or run this loop
// alongside the legacy agent-runner loop — either combination races two
// independent claimers over the same domain_events rows.
export async function pollAutomationEngine(logger: MinimalLogger): Promise<number> {
  const events = await claimDomainEvents();
  for (const event of events) {
    await processDomainEvent(event, logger);
  }
  return events.length;
}

// W5-T2: event-dispatcher subscriber entry point. The dispatcher has already
// claimed `event` via its own single claim query — this must not write
// domain_events.status/attempts itself (that's the dispatcher's job via
// onEventDone/onEventFailed + event_subscriber_progress). Throwing signals
// failure to the dispatcher, which records it and retries independently of
// other subscribers.
export async function runAutomationsForEvent(event: DomainEventRow, logger: MinimalLogger): Promise<void> {
  try {
    const automations = await loadAutomations(event);
    for (const automation of automations) {
      await processAutomation(automation, event);
    }
  } catch (err) {
    logger.warn({ err, eventId: event.id, eventType: event.event_type }, "Automation subscriber failed");
    throw err;
  }
}
