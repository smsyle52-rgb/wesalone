import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * W4-T2: cross-instance fan-out for workspace realtime events via Postgres
 * LISTEN/NOTIFY. Off by default (REALTIME_PUBSUB=true to enable) — the
 * in-process EventEmitter in events.ts remains the always-on local fast-path;
 * this only supplements it so events also reach *other* instances once
 * max-instances is raised above 1.
 */

const REALTIME_PUBSUB = process.env.REALTIME_PUBSUB === "true";
const CHANNEL = "workspace_events";
const INSTANCE_ID = randomUUID();
const MAX_NOTIFY_BYTES = 7500; // Postgres NOTIFY payload hard limit is 8000 bytes
const RECONNECT_DELAY_MS = 5_000;

let listenClient: PoolClient | null = null;
let reconnecting = false;

export function isRealtimePubSubEnabled(): boolean {
  return REALTIME_PUBSUB;
}

export async function publishRealtimeNotify(workspaceId: string, event: unknown): Promise<void> {
  if (!REALTIME_PUBSUB) return;
  try {
    const payload = JSON.stringify({ instanceId: INSTANCE_ID, event });
    if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFY_BYTES) {
      logger.warn({ workspaceId }, "Realtime event too large for NOTIFY — cross-instance fan-out skipped, local delivery unaffected");
      return;
    }
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, payload]);
  } catch (err) {
    logger.warn({ err, workspaceId }, "Failed to publish realtime NOTIFY — local delivery unaffected");
  }
}

export function startRealtimeListener(onEvent: (workspaceId: string, event: unknown) => void): void {
  if (!REALTIME_PUBSUB) return;
  void connect(onEvent);
}

async function connect(onEvent: (workspaceId: string, event: unknown) => void): Promise<void> {
  try {
    const client = await pool.connect();
    listenClient = client;
    await client.query(`LISTEN ${CHANNEL}`);

    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as { instanceId?: string; event?: { workspaceId?: string } };
        if (parsed.instanceId === INSTANCE_ID) return; // this instance already delivered it locally
        const workspaceId = parsed.event?.workspaceId;
        if (workspaceId) onEvent(workspaceId, parsed.event);
      } catch (err) {
        logger.warn({ err }, "Failed to parse realtime NOTIFY payload");
      }
    });

    client.on("error", (err) => {
      logger.warn({ err }, "Realtime LISTEN client error — reconnecting");
      scheduleReconnect(onEvent);
    });

    logger.info({ instanceId: INSTANCE_ID }, "Realtime LISTEN/NOTIFY connected");
  } catch (err) {
    logger.warn({ err }, "Failed to establish realtime LISTEN connection — retrying");
    scheduleReconnect(onEvent);
  }
}

function scheduleReconnect(onEvent: (workspaceId: string, event: unknown) => void): void {
  if (reconnecting) return;
  reconnecting = true;
  try {
    listenClient?.release();
  } catch {
    // already released/closed; nothing to do
  }
  listenClient = null;
  setTimeout(() => {
    reconnecting = false;
    void connect(onEvent);
  }, RECONNECT_DELAY_MS);
}
