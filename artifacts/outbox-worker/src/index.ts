import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pool } from "@workspace/db";
import pino from "pino";
import { pollAutomationEngine } from "./automation-engine";

type OutboxEventRow = {
  id: string;
  workspace_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const pollIntervalMs = 5_000;
const batchSize = 25;
const maxAttempts = 6;
const port = Number(process.env.PORT ?? "8080");
let shuttingDown = false;
let polling = false;
let automationPolling = false;
const processedTimestamps: number[] = [];

function markProcessed(): void {
  const now = Date.now();
  processedTimestamps.push(now);
  while (processedTimestamps[0] && processedTimestamps[0] < now - 60_000) {
    processedTimestamps.shift();
  }
}

function processedLastMinute(): number {
  const cutoff = Date.now() - 60_000;
  return processedTimestamps.filter((timestamp) => timestamp >= cutoff).length;
}

async function writeHeartbeat(): Promise<void> {
  await pool.query(
    `
    INSERT INTO service_heartbeats (service_name, last_beat_at, version, metadata)
    VALUES ('outbox-worker', now(), $1, $2::jsonb)
    ON CONFLICT (service_name)
    DO UPDATE SET last_beat_at = excluded.last_beat_at,
                  version = excluded.version,
                  metadata = excluded.metadata
    `,
    [
      process.env.npm_package_version ?? "0.0.0",
      JSON.stringify({ processedLastMinute: processedLastMinute(), pid: process.pid }),
    ],
  );
}

async function claimEvents(): Promise<OutboxEventRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<OutboxEventRow>(
      `
      UPDATE outbox_events
      SET status = 'processing'
      WHERE id IN (
        SELECT id
        FROM outbox_events
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
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

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadChannelAccount(channelAccountId: string | null) {
  if (!channelAccountId) return null;
  const result = await pool.query<{
    id: string;
    provider_config: Record<string, unknown> | null;
    credentials_secret_ref: string | null;
  }>("SELECT id, provider_config, credentials_secret_ref FROM channel_accounts WHERE id = $1 LIMIT 1", [channelAccountId]);
  return result.rows[0] ?? null;
}

async function metaSend(path: string, body: Record<string, unknown>): Promise<{ id: string; dryRun: boolean }> {
  const token = process.env.META_SYSTEM_USER_TOKEN ?? process.env.META_ACCESS_TOKEN;
  if (!process.env.META_APP_SECRET || !token || process.env.META_DRY_RUN === "true") {
    logger.info({ path }, "Meta outbox send DRY_RUN");
    return { id: `dry_${Date.now().toString(36)}`, dryRun: true };
  }

  const graphVersion = process.env.META_GRAPH_VERSION ?? "v21.0";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Meta Graph API returned ${response.status}`);
  }

  const payload: any = await response.json().catch(() => ({}));
  return { id: payload?.messages?.[0]?.id ?? payload?.id ?? `meta_${Date.now().toString(36)}`, dryRun: false };
}

async function dispatchWhatsAppSend(event: OutboxEventRow): Promise<void> {
  if (!process.env.META_APP_SECRET) {
    logger.info({ eventId: event.id }, "WhatsApp outbox send stubbed");
    return;
  }

  const token = process.env.META_SYSTEM_USER_TOKEN ?? process.env.META_ACCESS_TOKEN;
  const graphVersion = process.env.META_GRAPH_VERSION ?? "v21.0";
  const phoneNumberId = stringField(event.payload, "phoneNumberId") ?? process.env.META_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp credentials are not configured for live send");
  }

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event.payload),
  });

  if (!response.ok) {
    throw new Error(`Meta Graph API returned ${response.status}`);
  }
}

async function dispatchWhatsAppTemplate(event: OutboxEventRow): Promise<void> {
  const channelAccountId = stringField(event.payload, "channelAccountId");
  const templateId = stringField(event.payload, "templateId");
  const contactId = stringField(event.payload, "contactId");
  const channelAccount = await loadChannelAccount(channelAccountId);
  const providerConfig = channelAccount?.provider_config ?? {};
  const phoneNumberId = typeof providerConfig.phoneNumberId === "string" ? providerConfig.phoneNumberId : process.env.META_PHONE_NUMBER_ID;
  if (!phoneNumberId || !templateId || !contactId) throw new Error("Missing WhatsApp template outbox payload");

  const [templateResult, destinationResult] = await Promise.all([
    pool.query<{ name: string; language: string }>("SELECT name, language FROM whatsapp_templates WHERE id = $1 LIMIT 1", [templateId]),
    pool.query<{ destination: string }>(
      `
      SELECT COALESCE(cc.normalized_identifier, c.phone) AS destination
      FROM contacts c
      LEFT JOIN contact_channels cc ON cc.contact_id = c.id AND cc.channel_type IN ('whatsapp', 'phone')
      WHERE c.id = $1
      ORDER BY cc.is_primary DESC NULLS LAST
      LIMIT 1
      `,
      [contactId],
    ),
  ]);

  const template = templateResult.rows[0];
  const destination = destinationResult.rows[0]?.destination?.replace(/^\+/, "");
  if (!template || !destination) throw new Error("Unable to resolve WhatsApp template destination");

  const result = await metaSend(`${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: destination,
    type: "template",
    template: { name: template.name, language: { code: template.language }, components: [] },
  });

  if (event.entity_type === "broadcast_recipient") {
    await pool.query(
      "UPDATE broadcast_recipients SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'queued'",
      [event.entity_id],
    );
  }

  if (stringField(event.payload, "conversationId")) {
    await pool.query(
      `
      INSERT INTO messages (workspace_id, conversation_id, provider_message_id, direction, sender_type, source, content_type, content, delivery_status, provider_payload, sent_at)
      VALUES ($1, $2, $3, 'outbound', 'system', 'automation', 'template', $4, 'sent', $5::jsonb, now())
      `,
      [event.workspace_id, stringField(event.payload, "conversationId"), result.id, template.name, JSON.stringify({ dryRun: result.dryRun, outboxEventId: event.id })],
    );
  }
}

async function dispatchWhatsAppText(event: OutboxEventRow): Promise<void> {
  const channelAccountId = stringField(event.payload, "channelAccountId");
  const channelAccount = await loadChannelAccount(channelAccountId);
  const providerConfig = channelAccount?.provider_config ?? {};
  const phoneNumberId = typeof providerConfig.phoneNumberId === "string" ? providerConfig.phoneNumberId : process.env.META_PHONE_NUMBER_ID;
  const destination = stringField(event.payload, "to")?.replace(/^\+/, "");
  const body = stringField(event.payload, "body");
  if (!phoneNumberId || !destination || !body) throw new Error("Missing WhatsApp text outbox payload");

  const result = await metaSend(`${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: destination,
    type: "text",
    text: { body },
  });

  if (stringField(event.payload, "conversationId")) {
    await pool.query(
      `
      INSERT INTO messages (workspace_id, conversation_id, provider_message_id, direction, sender_type, source, content_type, content, delivery_status, provider_payload, sent_at)
      VALUES ($1, $2, $3, 'outbound', 'system', 'automation', 'text', $4, 'sent', $5::jsonb, now())
      `,
      [event.workspace_id, stringField(event.payload, "conversationId"), result.id, body, JSON.stringify({ dryRun: result.dryRun, outboxEventId: event.id })],
    );
  }
}

async function markSent(id: string): Promise<void> {
  await pool.query("UPDATE outbox_events SET status = 'sent', published_at = now() WHERE id = $1", [id]);
  markProcessed();
}

async function markFailed(id: string, reason: string): Promise<void> {
  await pool.query(
    `
    UPDATE outbox_events
    SET status = 'failed',
        payload = payload || jsonb_build_object('last_error', $2::text)
    WHERE id = $1
    `,
    [id, reason.slice(0, 500)],
  );
  markProcessed();
}

async function scheduleRetry(event: OutboxEventRow, err: unknown): Promise<void> {
  const attempts = event.attempts + 1;
  const status = attempts >= maxAttempts ? "dead_letter" : "pending";
  const delayMinutes = Math.pow(2, attempts);
  const nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000);
  const errorMessage = err instanceof Error ? err.message : "Unknown outbox error";

  await pool.query(
    `
    UPDATE outbox_events
    SET attempts = $2,
        status = $3,
        next_attempt_at = $4,
        payload = payload || jsonb_build_object('last_error', $5::text)
    WHERE id = $1
    `,
    [event.id, attempts, status, status === "dead_letter" ? null : nextAttemptAt, errorMessage.slice(0, 500)],
  );
  markProcessed();
}

async function processEvent(event: OutboxEventRow): Promise<void> {
  try {
    if (event.event_type === "message.send.whatsapp") {
      await dispatchWhatsAppSend(event);
      await markSent(event.id);
      return;
    }
    if (event.event_type === "message.send.whatsapp.template") {
      await dispatchWhatsAppTemplate(event);
      await markSent(event.id);
      return;
    }
    if (event.event_type === "message.send.whatsapp.text") {
      await dispatchWhatsAppText(event);
      await markSent(event.id);
      return;
    }

    await markFailed(event.id, `Unknown event_type: ${event.event_type}`);
  } catch (err) {
    logger.warn({ err, eventId: event.id, eventType: event.event_type }, "Outbox event failed");
    await scheduleRetry(event, err);
  }
}

async function pollOnce(): Promise<void> {
  if (polling || shuttingDown) return;
  polling = true;
  try {
    const events = await claimEvents();
    for (const event of events) {
      if (shuttingDown) break;
      await processEvent(event);
    }
  } catch (err) {
    logger.error({ err }, "Outbox poll failed");
  } finally {
    polling = false;
  }
}

async function pollAutomationOnce(): Promise<void> {
  if (automationPolling || shuttingDown) return;
  automationPolling = true;
  try {
    const processed = await pollAutomationEngine(logger);
    for (let i = 0; i < processed; i++) markProcessed();
  } catch (err) {
    logger.error({ err }, "Automation engine poll failed");
  } finally {
    automationPolling = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, processed_last_minute: processedLastMinute() }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(port, () => {
  logger.info({ port }, "Outbox worker health server listening");
});

const interval = setInterval(() => {
  void pollOnce();
}, pollIntervalMs);

const automationInterval = setInterval(() => {
  void pollAutomationOnce();
}, 3_000);

const heartbeatInterval = setInterval(() => {
  void writeHeartbeat().catch((err) => logger.warn({ err }, "Outbox worker heartbeat failed"));
}, 15_000);

void pollOnce();
void pollAutomationOnce();
void writeHeartbeat().catch((err) => logger.warn({ err }, "Initial outbox worker heartbeat failed"));

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Outbox worker shutting down");
  clearInterval(interval);
  clearInterval(automationInterval);
  clearInterval(heartbeatInterval);

  const shutdownDeadline = delay(9_000).then(() => "timeout" as const);
  const closeServer = new Promise<"closed">((resolve) => {
    server.close(() => resolve("closed"));
  });

  await Promise.race([shutdownDeadline, closeServer]);
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
