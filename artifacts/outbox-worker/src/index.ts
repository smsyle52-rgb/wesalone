import pg from "pg";
import { runAgentReply } from "@workspace/api-server/src/lib/agent-reply";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
const OUTBOX_INTERVAL_MS = 3_000;
const AGENT_INTERVAL_MS = 5_000;
const META_GRAPH_VERSION = "v19.0";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const logger = console;

type JsonRecord = Record<string, unknown>;

type OutboxEventRow = {
  id: string;
  workspace_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  status: string;
  attempts: number;
};

type DomainEventRow = {
  id: string;
  workspace_id: string;
  event_type: string;
  entity_id: string;
  payload: unknown;
};

type ConversationRow = {
  id: string;
  workspace_id: string;
  channel_account_id: string | null;
  external_thread_id: string | null;
  agent_status: string;
  agent_paused_until: Date | null;
  consecutive_agent_replies: number;
};

type ChannelAccountRow = {
  id: string;
  workspace_id: string;
  default_agent_id: string | null;
  provider_config: unknown;
};

type AiAgentRow = {
  id: string;
  workspace_id: string;
  status: string;
};

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function stringField(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function phoneNumberIdFromConfig(providerConfig: unknown): string | undefined {
  const config = asRecord(providerConfig);
  return stringField(config, "phone_number_id") ?? stringField(config, "phoneNumberId");
}

async function markDone(id: string): Promise<void> {
  await pool.query(
    "UPDATE domain_events SET status='done', processed_at=NOW() WHERE id=$1",
    [id],
  );
}

async function markFailed(id: string): Promise<void> {
  await pool.query(
    "UPDATE domain_events SET status='failed', processed_at=NOW() WHERE id=$1",
    [id],
  );
}

async function markOutboxDone(id: string): Promise<void> {
  await pool.query(
    "UPDATE outbox_events SET status='done', published_at=NOW() WHERE id=$1",
    [id],
  );
}

async function markOutboxFailedOrRetry(event: OutboxEventRow): Promise<void> {
  const attempts = event.attempts + 1;
  if (attempts < 3) {
    await pool.query(
      `
        UPDATE outbox_events
        SET attempts=$2,
            status='pending',
            next_attempt_at=NOW() + ($3 * INTERVAL '1 second')
        WHERE id=$1
      `,
      [event.id, attempts, attempts * 60],
    );
    return;
  }

  await pool.query(
    "UPDATE outbox_events SET attempts=$2, status='failed' WHERE id=$1",
    [event.id, attempts],
  );
}

async function sendWhatsAppText(params: {
  phoneNumberId: string;
  to: string;
  text: string;
}): Promise<void> {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN is required");

  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "text",
        text: { body: params.text },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Meta Graph API failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function handleOutboxEvent(event: OutboxEventRow): Promise<void> {
  const payload = asRecord(event.payload);
  const to = stringField(payload, "to");
  const text = stringField(payload, "text");
  const channelAccountId = stringField(payload, "channelAccountId");

  if (!to || !text || !channelAccountId) {
    throw new Error("Outbox payload must include to, text, and channelAccountId");
  }

  const { rows } = await pool.query<ChannelAccountRow>(
    `
      SELECT id, workspace_id, default_agent_id, provider_config
      FROM channel_accounts
      WHERE id=$1
      LIMIT 1
    `,
    [channelAccountId],
  );
  const channel = rows[0];
  if (!channel) throw new Error(`Channel account not found: ${channelAccountId}`);

  const phoneNumberId = phoneNumberIdFromConfig(channel.provider_config);
  if (!phoneNumberId) throw new Error(`Channel account ${channelAccountId} has no phone_number_id`);

  await sendWhatsAppText({ phoneNumberId, to, text });
  await markOutboxDone(event.id);
}

export async function runOutboxSender(): Promise<void> {
  const { rows } = await pool.query<OutboxEventRow>(
    `
      SELECT id, workspace_id, event_type, entity_type, entity_id, payload, status, attempts
      FROM outbox_events
      WHERE status='pending'
        AND event_type LIKE 'message.send.%'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY created_at ASC
      LIMIT 10
    `,
  );

  for (const event of rows) {
    try {
      await handleOutboxEvent(event);
    } catch (err) {
      logger.error({ err, outboxEventId: event.id }, "Failed to publish outbox event");
      await markOutboxFailedOrRetry(event);
    }
  }
}

async function claimDomainEvents(): Promise<DomainEventRow[]> {
  const { rows } = await pool.query<DomainEventRow>(
    `
      UPDATE domain_events
      SET status='processing'
      WHERE id IN (
        SELECT id FROM domain_events
        WHERE status='pending'
        ORDER BY created_at ASC
        LIMIT 5
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, workspace_id, event_type, entity_id, payload
    `,
  );
  return rows;
}

async function fetchConversation(event: DomainEventRow): Promise<ConversationRow | undefined> {
  const { rows } = await pool.query<ConversationRow>(
    `
      SELECT id,
             workspace_id,
             channel_account_id,
             external_thread_id,
             agent_status,
             agent_paused_until,
             consecutive_agent_replies
      FROM conversations
      WHERE id=$1 AND workspace_id=$2
      LIMIT 1
    `,
    [event.entity_id, event.workspace_id],
  );
  return rows[0];
}

async function fetchChannelAccount(
  workspaceId: string,
  channelAccountId: string,
): Promise<ChannelAccountRow | undefined> {
  const { rows } = await pool.query<ChannelAccountRow>(
    `
      SELECT id, workspace_id, default_agent_id, provider_config
      FROM channel_accounts
      WHERE id=$1 AND workspace_id=$2
      LIMIT 1
    `,
    [channelAccountId, workspaceId],
  );
  return rows[0];
}

async function fetchAiAgent(workspaceId: string, agentId: string): Promise<AiAgentRow | undefined> {
  const { rows } = await pool.query<AiAgentRow>(
    `
      SELECT id, workspace_id, status
      FROM ai_agents
      WHERE id=$1 AND workspace_id=$2
      LIMIT 1
    `,
    [agentId, workspaceId],
  );
  return rows[0];
}

async function pauseConversation(conversationId: string, resetReplies = false): Promise<void> {
  await pool.query(
    `
      UPDATE conversations
      SET agent_status='paused',
          agent_paused_until=NOW() + INTERVAL '30 minutes',
          consecutive_agent_replies=CASE WHEN $2 THEN 0 ELSE consecutive_agent_replies END,
          updated_at=NOW()
      WHERE id=$1
    `,
    [conversationId, resetReplies],
  );
}

async function markConversationHuman(conversationId: string): Promise<void> {
  await pool.query(
    "UPDATE conversations SET agent_status='human', updated_at=NOW() WHERE id=$1",
    [conversationId],
  );
}

async function enqueueAgentReply(params: {
  workspaceId: string;
  conversationId: string;
  channelAccountId: string;
  to: string;
  text: string;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO outbox_events (
        workspace_id,
        event_type,
        entity_type,
        entity_id,
        payload
      )
      VALUES (
        $1,
        'message.send.whatsapp.text',
        'message',
        $2,
        $3::jsonb
      )
    `,
    [
      params.workspaceId,
      params.conversationId,
      JSON.stringify({
        to: params.to,
        text: params.text,
        channelAccountId: params.channelAccountId,
      }),
    ],
  );
}

async function incrementAgentReplyCount(conversationId: string): Promise<void> {
  await pool.query(
    `
      UPDATE conversations
      SET consecutive_agent_replies=consecutive_agent_replies + 1,
          updated_at=NOW()
      WHERE id=$1
    `,
    [conversationId],
  );
}

async function handleDomainEvent(event: DomainEventRow): Promise<void> {
  const conversation = await fetchConversation(event);
  if (!conversation?.channel_account_id) {
    await markDone(event.id);
    return;
  }

  const channel = await fetchChannelAccount(conversation.workspace_id, conversation.channel_account_id);
  if (!channel?.default_agent_id) {
    await markDone(event.id);
    return;
  }

  const agent = await fetchAiAgent(conversation.workspace_id, channel.default_agent_id);
  if (!agent || agent.status !== "active") {
    await markDone(event.id);
    return;
  }

  if (
    conversation.agent_status === "paused"
    && conversation.agent_paused_until
    && conversation.agent_paused_until.getTime() > Date.now()
  ) {
    await markDone(event.id);
    return;
  }

  if (event.event_type === "message.echo") {
    await pauseConversation(conversation.id);
    await markDone(event.id);
    return;
  }

  if (conversation.consecutive_agent_replies >= 2) {
    await pauseConversation(conversation.id, true);
    await markDone(event.id);
    return;
  }

  const result = await runAgentReply({
    workspaceId: conversation.workspace_id,
    conversationId: conversation.id,
    agentId: channel.default_agent_id,
    systemUserId: SYSTEM_USER_ID,
  });

  if (result.shouldEscalate) {
    await markConversationHuman(conversation.id);
    await markDone(event.id);
    return;
  }

  if (!conversation.external_thread_id) {
    await markDone(event.id);
    return;
  }

  await enqueueAgentReply({
    workspaceId: conversation.workspace_id,
    conversationId: conversation.id,
    channelAccountId: conversation.channel_account_id,
    to: conversation.external_thread_id,
    text: result.reply,
  });
  await incrementAgentReplyCount(conversation.id);
  await markDone(event.id);
}

export async function runAgentRunner(): Promise<void> {
  const events = await claimDomainEvents();
  for (const event of events) {
    try {
      await handleDomainEvent(event);
    } catch (err) {
      logger.error({ err, domainEventId: event.id }, "Failed to process domain event");
      await markFailed(event.id);
    }
  }
}

function startLoop(name: string, intervalMs: number, handler: () => Promise<void>): void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await handler();
    } catch (err) {
      logger.error({ err }, `${name} loop failed`);
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
}

startLoop("outbox sender", OUTBOX_INTERVAL_MS, runOutboxSender);
startLoop("agent runner", AGENT_INTERVAL_MS, runAgentRunner);

logger.info("Outbox worker started");
