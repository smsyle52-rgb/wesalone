import type { IncomingHttpHeaders } from "node:http";
import { eq, and } from "drizzle-orm";
import { db, webhookEventsTable } from "@workspace/db";
import { hashValue, stableStringify } from "./idempotency.service";
import { isIntegrationProvider, type IntegrationProvider } from "./integrationTypes";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-hub-signature",
  "x-hub-signature-256",
]);

function sanitizeHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const clean: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) || value === undefined) continue;
    clean[key] = Array.isArray(value) ? value : String(value);
  }
  return clean;
}

function objectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractExternalEventId(payload: unknown): string | null {
  const direct =
    stringValue(objectValue(payload, "id")) ??
    stringValue(objectValue(payload, "event_id")) ??
    stringValue(objectValue(payload, "eventId")) ??
    stringValue(objectValue(payload, "message_id")) ??
    stringValue(objectValue(payload, "messageId"));

  if (direct) return direct;

  const message = objectValue(payload, "message");
  const messageId = stringValue(objectValue(message, "id")) ?? stringValue(objectValue(message, "message_id"));
  if (messageId) return messageId;

  const entry = objectValue(payload, "entry");
  if (Array.isArray(entry)) {
    const firstId = stringValue(objectValue(entry[0], "id"));
    if (firstId) return firstId;
  }

  return null;
}

function extractEventType(provider: IntegrationProvider, payload: unknown): string {
  return (
    stringValue(objectValue(payload, "event_type")) ??
    stringValue(objectValue(payload, "eventType")) ??
    stringValue(objectValue(payload, "type")) ??
    stringValue(objectValue(payload, "object")) ??
    `${provider}_webhook`
  );
}

export function computeWebhookIdempotencyKey(provider: IntegrationProvider, payload: unknown) {
  const externalEventId = extractExternalEventId(payload);
  if (externalEventId) return { externalEventId, idempotencyKey: externalEventId };
  return { externalEventId: null, idempotencyKey: hashValue({ provider, payload }) };
}

export async function ingestWebhookEvent(params: {
  provider: string;
  headers: IncomingHttpHeaders;
  payload: unknown;
}) {
  if (!isIntegrationProvider(params.provider)) {
    return { accepted: false, duplicate: false, reason: "unsupported_provider" as const };
  }

  const provider = params.provider;
  const { externalEventId, idempotencyKey } = computeWebhookIdempotencyKey(provider, params.payload);

  const [existing] = await db
    .select()
    .from(webhookEventsTable)
    .where(and(eq(webhookEventsTable.provider, provider), eq(webhookEventsTable.idempotencyKey, idempotencyKey)))
    .limit(1);

  if (existing) return { accepted: true, duplicate: true, event: existing };

  const [event] = await db
    .insert(webhookEventsTable)
    .values({
      workspaceId: null,
      provider,
      providerAccountId: null,
      eventType: extractEventType(provider, params.payload),
      externalEventId,
      idempotencyKey,
      headers: sanitizeHeaders(params.headers),
      payload: typeof params.payload === "undefined" ? {} : JSON.parse(stableStringify(params.payload)),
      status: "received",
    })
    .returning();

  return { accepted: true, duplicate: false, event };
}
