import type pg from "pg";

type Pool = InstanceType<typeof pg.Pool>;

type WebhookEventRow = {
  id: string;
  provider: string;
  retry_count: number;
};

function errorMsg(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function logAlert(type: string, fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ severity: "CRITICAL", alert: type, ...fields }) + "\n");
}

async function claimWebhookEvents(pool: Pool): Promise<WebhookEventRow[]> {
  const { rows } = await pool.query<WebhookEventRow>(
    `UPDATE webhook_events
     SET status = 'processing'
     WHERE id IN (
       SELECT id FROM webhook_events
       WHERE status = 'received'
         AND provider = 'meta'
       ORDER BY received_at ASC
       LIMIT 5
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, provider, retry_count`,
  );
  return rows;
}

async function markWebhookFailed(
  pool: Pool,
  eventId: string,
  retryCount: number,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE webhook_events
     SET status = 'failed', retry_count = $2, error_message = $3, processed_at = NOW()
     WHERE id = $1`,
    [eventId, retryCount, errorMessage.slice(0, 500)],
  );
  await pool.query(
    `INSERT INTO dead_letter_events (workspace_id, source_type, source_id, provider, reason, payload, created_at)
     SELECT workspace_id, 'webhook_events', id, provider, $2, payload, NOW()
     FROM webhook_events WHERE id = $1
     ON CONFLICT DO NOTHING`,
    [eventId, errorMessage.slice(0, 500)],
  );
  logAlert("webhook_events.permanently_failed", { webhookEventId: eventId });
}

async function markWebhookRetry(
  pool: Pool,
  eventId: string,
  retryCount: number,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE webhook_events
     SET status = 'received', retry_count = $2, error_message = $3
     WHERE id = $1`,
    [eventId, retryCount, errorMessage.slice(0, 500)],
  );
}

async function callDispatch(
  event: WebhookEventRow,
  apiServerUrl: string,
  internalSecret: string,
): Promise<void> {
  const response = await fetch(`${apiServerUrl}/internal/dispatch-webhook-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret,
    },
    body: JSON.stringify({ webhookEventId: event.id }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`dispatch-webhook-event ${response.status}: ${body.slice(0, 300)}`);
  }
}

export async function runIngestionDispatcher(params: {
  pool: Pool;
  apiServerUrl: string;
  internalSecret: string;
}): Promise<void> {
  console.log("ingestion-dispatcher: polling...", new Date().toISOString());

  const events = await claimWebhookEvents(params.pool);
  for (const event of events) {
    try {
      await callDispatch(event, params.apiServerUrl, params.internalSecret);
    } catch (err) {
      const msg = errorMsg(err);
      console.error("ingestion-dispatcher: dispatch error", msg);
      const retryCount = event.retry_count + 1;
      if (retryCount >= 3) {
        await markWebhookFailed(params.pool, event.id, retryCount, msg);
      } else {
        await markWebhookRetry(params.pool, event.id, retryCount, msg);
      }
    }
  }
}
