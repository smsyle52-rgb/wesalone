import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pool } from "@workspace/db";
import pino from "pino";

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

void pollOnce();

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Outbox worker shutting down");
  clearInterval(interval);

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
