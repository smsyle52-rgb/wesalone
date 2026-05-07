import { and, desc, eq } from "drizzle-orm";
import { db, outboxMessagesTable, providerDeliveryAttemptsTable } from "@workspace/db";
import type { IntegrationProvider } from "./integrationTypes";

export async function listOutboxMessages(workspaceId: string, limit = 50) {
  return db
    .select()
    .from(outboxMessagesTable)
    .where(eq(outboxMessagesTable.workspaceId, workspaceId))
    .orderBy(desc(outboxMessagesTable.createdAt))
    .limit(limit);
}

export async function getOutboxMessage(workspaceId: string, id: string) {
  const [message] = await db
    .select()
    .from(outboxMessagesTable)
    .where(and(eq(outboxMessagesTable.id, id), eq(outboxMessagesTable.workspaceId, workspaceId)))
    .limit(1);
  return message ?? null;
}

export async function createOutboxMessage(params: {
  workspaceId: string;
  provider: IntegrationProvider;
  providerAccountId?: string | null;
  channelAccountId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  destination: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  scheduledAt?: Date | null;
  createdBy?: string | null;
}) {
  const [existing] = await db
    .select()
    .from(outboxMessagesTable)
    .where(and(
      eq(outboxMessagesTable.workspaceId, params.workspaceId),
      eq(outboxMessagesTable.idempotencyKey, params.idempotencyKey),
    ))
    .limit(1);

  if (existing) return { duplicate: true, message: existing };

  const [message] = await db
    .insert(outboxMessagesTable)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      providerAccountId: params.providerAccountId ?? null,
      channelAccountId: params.channelAccountId ?? null,
      conversationId: params.conversationId ?? null,
      messageId: params.messageId ?? null,
      destination: params.destination,
      payload: params.payload,
      status: "pending",
      idempotencyKey: params.idempotencyKey,
      scheduledAt: params.scheduledAt ?? null,
      createdBy: params.createdBy ?? null,
    })
    .returning();

  return { duplicate: false, message };
}

export async function markSending(workspaceId: string, id: string) {
  const existing = await getOutboxMessage(workspaceId, id);
  if (!existing || existing.status !== "pending") return null;

  const [message] = await db
    .update(outboxMessagesTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(eq(outboxMessagesTable.id, existing.id))
    .returning();
  return message;
}

export async function markSent(workspaceId: string, id: string) {
  const existing = await getOutboxMessage(workspaceId, id);
  if (!existing) return null;

  const [message] = await db
    .update(outboxMessagesTable)
    .set({ status: "sent", sentAt: new Date(), failedAt: null, errorMessage: null, updatedAt: new Date() })
    .where(eq(outboxMessagesTable.id, existing.id))
    .returning();
  return message;
}

export async function markFailed(workspaceId: string, id: string, errorMessage: string) {
  const existing = await getOutboxMessage(workspaceId, id);
  if (!existing) return null;

  const [message] = await db
    .update(outboxMessagesTable)
    .set({
      status: "failed",
      failedAt: new Date(),
      errorMessage,
      retryCount: existing.retryCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(outboxMessagesTable.id, existing.id))
    .returning();

  await db.insert(providerDeliveryAttemptsTable).values({
    workspaceId,
    outboxMessageId: existing.id,
    provider: existing.provider,
    attemptNumber: message.retryCount,
    requestPayload: existing.payload as Record<string, unknown>,
    status: "failed",
    errorMessage,
  });

  return message;
}

export function isRetryEligible(status: string) {
  return status === "failed";
}

export async function cancelOutboxMessage(workspaceId: string, id: string) {
  const existing = await getOutboxMessage(workspaceId, id);
  if (!existing || existing.status === "sent" || existing.status === "cancelled") return null;

  const [message] = await db
    .update(outboxMessagesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(outboxMessagesTable.id, existing.id))
    .returning();
  return message;
}

export async function retryOutboxMessage(workspaceId: string, id: string) {
  const existing = await getOutboxMessage(workspaceId, id);
  if (!existing || !isRetryEligible(existing.status)) return null;

  const [message] = await db
    .update(outboxMessagesTable)
    .set({
      status: "pending",
      failedAt: null,
      errorMessage: null,
      retryCount: existing.retryCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(outboxMessagesTable.id, existing.id))
    .returning();
  return message;
}
