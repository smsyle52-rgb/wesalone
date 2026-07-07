import { createDecipheriv, createHash } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";
import { runIngestionDispatcher } from "./ingestion-dispatcher";
import { runEventDispatcher } from "./event-dispatcher";

const OUTBOX_INTERVAL_MS = 3_000;
const AGENT_INTERVAL_MS = 5_000;
const INGESTION_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 300_000;
const INGEST_DEFERRED = process.env.INGEST_DEFERRED === "true";
const EVENT_DISPATCHER = process.env.EVENT_DISPATCHER === "true";
const META_DRY_RUN = process.env.META_DRY_RUN === "true";
const WHATSAPP_BSUID_ENABLED = process.env.WHATSAPP_BSUID_ENABLED === "true";
const META_GRAPH_VERSION = "v22.0";
const API_SERVER_URL = (process.env.API_SERVER_URL ?? "http://localhost:8080").replace(/\/$/, "");
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const logger = console;
const port = Number(process.env.PORT ?? "8080");

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
  credentials_secret_ref: string | null;
  channel_type: string;
};

type AiAgentRow = {
  id: string;
  workspace_id: string;
  status: string;
};

type InternalAgentReplyResponse = {
  success: boolean;
  outboxEventId?: string | null;
  shouldEscalate?: boolean;
};

function errorDetails(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack ?? ""}`.trim();
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Cloud Logging structured log — severity=CRITICAL triggers log-based alerts
function logAlert(type: string, fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ severity: "CRITICAL", alert: type, ...fields }) + "\n");
}

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

function maskExternalId(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

function phoneNumberIdFromConfig(providerConfig: unknown): string | undefined {
  const config = asRecord(providerConfig);
  return stringField(config, "phone_number_id") ?? stringField(config, "phoneNumberId");
}

function pageIdFromConfig(providerConfig: unknown): string | undefined {
  const config = asRecord(providerConfig);
  return stringField(config, "pageId") ?? stringField(config, "page_id");
}

function decryptTokenRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith("enc:v1:")) return null;
  const secret = process.env.META_OAUTH_STATE_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const parts = ref.split(":");
    if (parts.length !== 5) return null;
    const key = createHash("sha256").update(secret).digest();
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const data = Buffer.from(parts[4], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function shouldDryRunMetaSend(): boolean {
  return META_DRY_RUN || !process.env.META_APP_SECRET || !process.env.META_SYSTEM_USER_TOKEN;
}

function logMetaDryRun(eventType: string, details: Record<string, unknown>): void {
  logger.info({ eventType, ...details }, "Meta outbox send DRY_RUN");
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
    "UPDATE outbox_events SET status='done', published_at=NOW() WHERE id=$1 AND status='processing'",
    [id],
  );
}

// W4-T1: per-attempt delivery ledger, keyed off the live outbox_events model.
// Best-effort only — a logging failure must never break the send/retry path itself.
async function recordDeliveryAttempt(params: {
  workspaceId: string | null;
  outboxEventId: string;
  provider: string;
  attemptNumber: number;
  status: "success" | "failed";
  errorMessage?: string;
  requestPayload?: JsonRecord;
}): Promise<void> {
  if (!params.workspaceId) return;
  try {
    await pool.query(
      `
        INSERT INTO provider_delivery_attempts
          (workspace_id, outbox_event_id, provider, attempt_number, request_payload, status, error_message)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      `,
      [
        params.workspaceId,
        params.outboxEventId,
        params.provider,
        params.attemptNumber,
        JSON.stringify(params.requestPayload ?? {}),
        params.status,
        params.errorMessage ? params.errorMessage.slice(0, 500) : null,
      ],
    );
  } catch (err) {
    console.error("outbox-sender: failed to record delivery attempt", errorDetails(err));
  }
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
        WHERE id=$1 AND status='processing'
      `,
      [event.id, attempts, attempts * 60],
    );
    return;
  }

  await pool.query(
    "UPDATE outbox_events SET attempts=$2, status='failed' WHERE id=$1 AND status='processing'",
    [event.id, attempts],
  );

  const payload = asRecord(event.payload);
  const conversationId = stringField(payload, "conversationId");
  logAlert("outbox.permanently_failed", { outboxEventId: event.id, eventType: event.event_type, conversationId });

  // Q4 fix: escalate conversation to human on final outbox failure
  if (conversationId) {
    await pool.query(
      "UPDATE conversations SET agent_status='human', updated_at=NOW() WHERE id=$1",
      [conversationId],
    ).catch((err) => {
      console.error("Failed to escalate conversation after outbox failure", err);
    });
  }
}

async function dispatchWhatsAppText(params: {
  phoneNumberId: string;
  to: string;
  text: string;
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.whatsapp.text", { phoneNumberId: params.phoneNumberId, to: maskExternalId(params.to) });
    return;
  }
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

async function sendWhatsAppMedia(params: {
  phoneNumberId: string;
  to: string;
  mediaType: string;
  mediaUrl: string;
  caption?: string;
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.whatsapp.media", { phoneNumberId: params.phoneNumberId, to: maskExternalId(params.to), mediaType: params.mediaType });
    return;
  }
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN is required");

  const supportedType = ["image", "video", "document"].includes(params.mediaType)
    ? params.mediaType
    : "image";
  const mediaBody = {
    link: params.mediaUrl,
    ...(params.caption && supportedType !== "document" ? { caption: params.caption } : {}),
  };

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
        type: supportedType,
        [supportedType]: mediaBody,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Meta Graph API media send failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function sendWhatsAppTemplate(params: {
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  components: unknown[];
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.whatsapp.template", { phoneNumberId: params.phoneNumberId, to: maskExternalId(params.to), templateName: params.templateName });
    return;
  }
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
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.language },
          components: params.components,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Meta Graph API template failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function sendInstagramMedia(params: {
  pageId: string;
  recipientId: string;
  mediaUrl: string;
  mediaType: string;
  pageToken: string;
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.instagram.media", { pageId: params.pageId, recipientId: params.recipientId, mediaType: params.mediaType });
    return;
  }
  const attachmentType = ["image", "video", "audio"].includes(params.mediaType) ? params.mediaType : "image";
  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${params.pageId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.pageToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: params.recipientId },
        message: {
          attachment: {
            type: attachmentType,
            payload: { url: params.mediaUrl },
          },
        },
        messaging_type: "RESPONSE",
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Instagram media send failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function sendMessengerMedia(params: {
  pageId: string;
  recipientId: string;
  mediaUrl: string;
  mediaType: string;
  pageToken: string;
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.messenger.media", { pageId: params.pageId, recipientId: params.recipientId, mediaType: params.mediaType });
    return;
  }
  const attachmentType = ["image", "video", "audio", "file"].includes(params.mediaType)
    ? (params.mediaType === "document" ? "file" : params.mediaType)
    : "image";
  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${params.pageId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.pageToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: params.recipientId },
        message: {
          attachment: {
            type: attachmentType,
            payload: { url: params.mediaUrl },
          },
        },
        messaging_type: "RESPONSE",
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Messenger media send failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function sendInstagramMessage(params: {
  pageId: string;
  recipientId: string;
  text: string;
  pageToken: string;
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.instagram.text", { pageId: params.pageId, recipientId: params.recipientId });
    return;
  }
  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${params.pageId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.pageToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: params.recipientId },
        message: { text: params.text },
        messaging_type: "RESPONSE",
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Instagram Graph API failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function sendMessengerMessage(params: {
  pageId: string;
  recipientId: string;
  text: string;
  pageToken: string;
}): Promise<void> {
  if (shouldDryRunMetaSend()) {
    logMetaDryRun("message.send.messenger.text", { pageId: params.pageId, recipientId: params.recipientId });
    return;
  }
  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${params.pageId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.pageToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: params.recipientId },
        message: { text: params.text },
        messaging_type: "RESPONSE",
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Messenger Graph API failed with ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function handleOutboxEvent(event: OutboxEventRow): Promise<void> {
  const payload = asRecord(event.payload);
  const to = stringField(payload, "to");
  const text = stringField(payload, "text") ?? stringField(payload, "body");
  const channelAccountId = stringField(payload, "channelAccountId");
  const mediaUrl = stringField(payload, "mediaUrl");
  const mediaType = stringField(payload, "mediaType") ?? "image";
  const caption = stringField(payload, "caption");
  const recipientIdentityType = stringField(payload, "recipientIdentityType") ?? stringField(payload, "toIdentityType");

  if (!to || !channelAccountId) {
    throw new Error("Outbox payload must include to and channelAccountId");
  }

  const { rows } = await pool.query<ChannelAccountRow>(
    `
      SELECT id, workspace_id, default_agent_id, provider_config, credentials_secret_ref, channel_type
      FROM channel_accounts
      WHERE id=$1
      LIMIT 1
    `,
    [channelAccountId],
  );
  const channel = rows[0];
  if (!channel) throw new Error(`Channel account not found: ${channelAccountId}`);

  const attemptNumber = event.attempts + 1;
  const recordAttempt = (status: "success" | "failed", errorMessage?: string) =>
    recordDeliveryAttempt({
      workspaceId: channel.workspace_id,
      outboxEventId: event.id,
      provider: channel.channel_type,
      attemptNumber,
      status,
      errorMessage,
      requestPayload: { eventType: event.event_type, to: maskExternalId(to) },
    });

  // PD-6 fix: route outbound message by channel type
  if (channel.channel_type === "instagram") {
    // IG (Facebook-login model) sends through the LINKED PAGE with a page token + IGSID recipient.
    // Posting to {igAccountId}/messages returns Meta error (#3) "does not have the capability".
    const pageId = pageIdFromConfig(channel.provider_config);
    if (!pageId) throw new Error(`Channel account ${channelAccountId} has no linked pageId for Instagram send`);
    const pageToken = decryptTokenRef(channel.credentials_secret_ref) ?? process.env.META_SYSTEM_USER_TOKEN;
    if (!pageToken) throw new Error(`No access token for Instagram channel ${channelAccountId}`);

    const isMediaEvent = event.event_type === "message.send.instagram.media" || Boolean(mediaUrl);
    if (isMediaEvent) {
      if (!mediaUrl) throw new Error("Instagram media outbox payload must include mediaUrl");
      await sendInstagramMedia({ pageId, recipientId: to, mediaUrl, mediaType, pageToken });
      if (text) await sendInstagramMessage({ pageId, recipientId: to, text, pageToken });
    } else {
      if (!text) throw new Error("Instagram outbox payload must include text or body");
      await sendInstagramMessage({ pageId, recipientId: to, text, pageToken });
    }
    await markOutboxDone(event.id);
    await recordAttempt("success");
    return;
  }

  if (channel.channel_type === "messenger") {
    const pageId = pageIdFromConfig(channel.provider_config);
    if (!pageId) throw new Error(`Channel account ${channelAccountId} has no pageId`);
    const pageToken = decryptTokenRef(channel.credentials_secret_ref) ?? process.env.META_SYSTEM_USER_TOKEN;
    if (!pageToken) throw new Error(`No access token for Messenger channel ${channelAccountId}`);

    const isMediaEvent = event.event_type === "message.send.messenger.media" || Boolean(mediaUrl);
    if (isMediaEvent) {
      if (!mediaUrl) throw new Error("Messenger media outbox payload must include mediaUrl");
      await sendMessengerMedia({ pageId, recipientId: to, mediaUrl, mediaType, pageToken });
      if (text) await sendMessengerMessage({ pageId, recipientId: to, text, pageToken });
    } else {
      if (!text) throw new Error("Messenger outbox payload must include text or body");
      await sendMessengerMessage({ pageId, recipientId: to, text, pageToken });
    }
    await markOutboxDone(event.id);
    await recordAttempt("success");
    return;
  }

  // WhatsApp path (default)
  const phoneNumberId = phoneNumberIdFromConfig(channel.provider_config);
  if (!phoneNumberId) throw new Error(`Channel account ${channelAccountId} has no phone_number_id`);
  if (recipientIdentityType === "whatsapp_bsuid" && !WHATSAPP_BSUID_ENABLED) {
    throw new Error("WHATSAPP_BSUID_RECIPIENT_DISABLED");
  }

  if (event.event_type === "message.send.whatsapp.template") {
    if (recipientIdentityType === "whatsapp_bsuid") {
      throw new Error("WHATSAPP_TEMPLATE_REQUIRES_PHONE_RECIPIENT");
    }
    const templateName = stringField(payload, "templateName");
    const language = stringField(payload, "language") ?? "ar";
    const components = Array.isArray((payload as Record<string, unknown>).components)
      ? (payload as Record<string, unknown>).components as unknown[]
      : [];
    if (!templateName) throw new Error("Template outbox payload must include templateName");
    await sendWhatsAppTemplate({ phoneNumberId, to, templateName, language, components });
    await markOutboxDone(event.id);
    await recordAttempt("success");
    return;
  }

  if (event.event_type === "message.send.whatsapp.media") {
    if (!mediaUrl) throw new Error("Media outbox payload must include mediaUrl");
    await sendWhatsAppMedia({ phoneNumberId, to, mediaType, mediaUrl, caption });
    await markOutboxDone(event.id);
    await recordAttempt("success");
    return;
  }

  if (!text) {
    throw new Error("Text outbox payload must include text or body");
  }

  // Q3 fix: enforce WhatsApp 24h customer service window
  const conversationId = stringField(payload, "conversationId");
  if (conversationId) {
    const { rows: msgRows } = await pool.query<{ sent_at: string }>(
      "SELECT sent_at FROM messages WHERE conversation_id=$1 AND direction='inbound' ORDER BY sent_at DESC LIMIT 1",
      [conversationId],
    );
    const lastInboundAt = msgRows[0]?.sent_at;
    if (lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() > 86_400_000) {
      await pool.query(
        "UPDATE outbox_events SET status='failed', attempts=3 WHERE id=$1 AND status='processing'",
        [event.id],
      );
      await pool.query(
        "UPDATE conversations SET agent_status='human', updated_at=NOW() WHERE id=$1",
        [conversationId],
      ).catch(() => {});
      logger.warn({ outboxEventId: event.id, conversationId }, "WhatsApp 24h window expired — escalating to human");
      await recordAttempt("failed", "WhatsApp 24h customer service window expired");
      return;
    }
  }

  await dispatchWhatsAppText({ phoneNumberId, to, text });
  await markOutboxDone(event.id);
  await recordAttempt("success");
}

async function claimOutboxEvents(): Promise<OutboxEventRow[]> {
  const { rows } = await pool.query<OutboxEventRow>(
    `
      UPDATE outbox_events
      SET status='processing'
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status='pending'
          AND event_type LIKE 'message.send.%'
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, workspace_id, event_type, entity_type, entity_id, payload, status, attempts
    `,
  );
  return rows;
}

export async function runOutboxSender(): Promise<void> {
  console.log("outbox-sender: polling...", new Date().toISOString());

  const events = await claimOutboxEvents();

  for (const event of events) {
    try {
      await handleOutboxEvent(event);
    } catch (err) {
      console.error("outbox-sender: error", errorDetails(err));
      logger.error({ err, outboxEventId: event.id }, "Failed to publish outbox event");
      await recordDeliveryAttempt({
        workspaceId: event.workspace_id,
        outboxEventId: event.id,
        provider: event.event_type.split(".")[2] ?? "unknown",
        attemptNumber: event.attempts + 1,
        status: "failed",
        errorMessage: errorDetails(err),
        requestPayload: { eventType: event.event_type },
      });
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
          AND event_type IN ('message.received', 'message.echo')
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
  const payload = asRecord(event.payload);
  const conversationIdFromPayload = stringField(payload, "conversationId");
  const messageIdFromPayload = stringField(payload, "messageId");

  const candidateIds = [conversationIdFromPayload, event.entity_id].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  for (const conversationId of [...new Set(candidateIds)]) {
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
      [conversationId, event.workspace_id],
    );
    if (rows[0]) return rows[0];
  }

  if (messageIdFromPayload) {
    const { rows } = await pool.query<ConversationRow>(
      `
        SELECT c.id,
               c.workspace_id,
               c.channel_account_id,
               c.external_thread_id,
               c.agent_status,
               c.agent_paused_until,
               c.consecutive_agent_replies
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id AND c.workspace_id = m.workspace_id
        WHERE m.id=$1 AND m.workspace_id=$2
        LIMIT 1
      `,
      [messageIdFromPayload, event.workspace_id],
    );
    if (rows[0]) return rows[0];
  }

  const { rows } = await pool.query<ConversationRow>(
    `
      SELECT c.id,
             c.workspace_id,
             c.channel_account_id,
             c.external_thread_id,
             c.agent_status,
             c.agent_paused_until,
             c.consecutive_agent_replies
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id AND c.workspace_id = m.workspace_id
      WHERE m.id=$1 AND m.workspace_id=$2
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
      SELECT id, workspace_id, default_agent_id, provider_config, credentials_secret_ref, channel_type
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

async function clearExpiredPause(conversationId: string): Promise<void> {
  await pool.query(
    `
      UPDATE conversations
      SET agent_status='active',
          agent_paused_until=NULL,
          updated_at=NOW()
      WHERE id=$1
        AND agent_status='paused'
        AND agent_paused_until IS NOT NULL
        AND agent_paused_until <= NOW()
    `,
    [conversationId],
  );
}

async function requestInternalAgentReply(params: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  domainEventId: string;
}): Promise<InternalAgentReplyResponse> {
  if (!INTERNAL_SECRET) throw new Error("INTERNAL_SECRET is required");

  const response = await fetch(`${API_SERVER_URL}/internal/agent-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      agentId: params.agentId,
      domainEventId: params.domainEventId,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Internal agent reply API failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  return response.json() as Promise<InternalAgentReplyResponse>;
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

  if (conversation.agent_status === "human") {
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

  if (conversation.agent_status === "paused") {
    await clearExpiredPause(conversation.id);
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

  const result = await requestInternalAgentReply({
    workspaceId: conversation.workspace_id,
    conversationId: conversation.id,
    agentId: channel.default_agent_id,
    domainEventId: event.id,
  });

  if (result.shouldEscalate) {
    await markConversationHuman(conversation.id);
    await markDone(event.id);
    return;
  }

  if (result.outboxEventId) await incrementAgentReplyCount(conversation.id);
  await markDone(event.id);
}

export async function runAgentRunner(): Promise<void> {
  console.log("agent-runner: polling...", new Date().toISOString());

  const events = await claimDomainEvents();
  for (const event of events) {
    try {
      await handleDomainEvent(event);
    } catch (err) {
      console.error("agent-runner: error", errorDetails(err));
      logger.error({ err, domainEventId: event.id }, "Failed to process domain event");
      logAlert("domain_event.failed", { domainEventId: event.id, eventType: event.event_type, workspaceId: event.workspace_id });
      await markFailed(event.id);
    }
  }
}

async function writeHeartbeat(): Promise<void> {
  await pool.query(
    `INSERT INTO service_heartbeats(service_name, last_beat_at)
     VALUES('outbox-worker', NOW())
     ON CONFLICT (service_name) DO UPDATE SET last_beat_at=EXCLUDED.last_beat_at`,
  );
}

async function runCleanup(): Promise<void> {
  if (!INTERNAL_SECRET) return;
  await Promise.all([
    fetch(`${API_SERVER_URL}/internal/cleanup-outbox`, {
      method: "POST",
      headers: { "X-Internal-Secret": INTERNAL_SECRET },
    }),
    fetch(`${API_SERVER_URL}/internal/cleanup-domain-events`, {
      method: "POST",
      headers: { "X-Internal-Secret": INTERNAL_SECRET },
    }),
  ]);
}

function startLoop(name: string, intervalMs: number, handler: () => Promise<void>): void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await handler();
    } catch (err) {
      console.error(`${name}: loop error`, errorDetails(err));
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

createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
}).listen(port, () => {
  logger.info(`Outbox worker health server listening on ${port}`);
});

startLoop("outbox sender", OUTBOX_INTERVAL_MS, runOutboxSender);
if (EVENT_DISPATCHER) {
  // W4-T3: one claimer fans domain_events to subscribers, tracked idempotently
  // per (event, subscriber). handleDomainEvent itself is unchanged — only the
  // claiming mechanism differs from the legacy loop below.
  startLoop("event dispatcher", AGENT_INTERVAL_MS, () =>
    runEventDispatcher({
      pool,
      subscribers: [{ name: "agent", handler: (event) => handleDomainEvent(event) }],
      onEventDone: markDone,
      onEventFailed: markFailed,
      logError: (err, context) => {
        console.error("event-dispatcher: subscriber error", errorDetails(err), context);
        logger.error({ err, ...context }, "Event subscriber failed");
      },
    }),
  );
} else {
  startLoop("agent runner", AGENT_INTERVAL_MS, runAgentRunner);
}
startLoop("heartbeat", HEARTBEAT_INTERVAL_MS, writeHeartbeat);
startLoop("cleanup", CLEANUP_INTERVAL_MS, runCleanup);
if (INGEST_DEFERRED) {
  startLoop("ingestion dispatcher", INGESTION_INTERVAL_MS, () =>
    runIngestionDispatcher({ pool, apiServerUrl: API_SERVER_URL, internalSecret: INTERNAL_SECRET }),
  );
}

logger.info("Outbox worker started");
