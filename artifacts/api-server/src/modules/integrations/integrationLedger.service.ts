import { and, count, desc, eq } from "drizzle-orm";
import {
  db,
  deadLetterEventsTable,
  providerAccountsTable,
  webhookEventsTable,
} from "@workspace/db";
import type { IntegrationProvider, ProviderAccountStatus } from "./integrationTypes";

export async function listProviderAccounts(workspaceId: string) {
  return db
    .select()
    .from(providerAccountsTable)
    .where(eq(providerAccountsTable.workspaceId, workspaceId))
    .orderBy(desc(providerAccountsTable.createdAt));
}

export async function getProviderAccount(workspaceId: string, id: string) {
  const [account] = await db
    .select()
    .from(providerAccountsTable)
    .where(and(eq(providerAccountsTable.id, id), eq(providerAccountsTable.workspaceId, workspaceId)))
    .limit(1);
  return account ?? null;
}

export async function createProviderAccount(params: {
  workspaceId: string;
  provider: IntegrationProvider;
  displayName: string;
  status?: ProviderAccountStatus;
  externalAccountId?: string | null;
  externalBusinessId?: string | null;
  externalPhoneId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy: string;
}) {
  const [account] = await db
    .insert(providerAccountsTable)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      displayName: params.displayName,
      status: params.status ?? "draft",
      externalAccountId: params.externalAccountId ?? null,
      externalBusinessId: params.externalBusinessId ?? null,
      externalPhoneId: params.externalPhoneId ?? null,
      metadata: params.metadata ?? {},
      createdBy: params.createdBy,
    })
    .returning();
  return account;
}

export async function updateProviderAccount(params: {
  workspaceId: string;
  id: string;
  displayName?: string;
  status?: ProviderAccountStatus;
  externalAccountId?: string | null;
  externalBusinessId?: string | null;
  externalPhoneId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const existing = await getProviderAccount(params.workspaceId, params.id);
  if (!existing) return null;

  const [account] = await db
    .update(providerAccountsTable)
    .set({
      ...(params.displayName !== undefined && { displayName: params.displayName }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.externalAccountId !== undefined && { externalAccountId: params.externalAccountId }),
      ...(params.externalBusinessId !== undefined && { externalBusinessId: params.externalBusinessId }),
      ...(params.externalPhoneId !== undefined && { externalPhoneId: params.externalPhoneId }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date(),
    })
    .where(eq(providerAccountsTable.id, existing.id))
    .returning();

  return account;
}

export async function disableProviderAccount(workspaceId: string, id: string) {
  return updateProviderAccount({ workspaceId, id, status: "disabled" });
}

export async function listWebhookEvents(workspaceId: string, limit = 50) {
  return db
    .select()
    .from(webhookEventsTable)
    .where(eq(webhookEventsTable.workspaceId, workspaceId))
    .orderBy(desc(webhookEventsTable.receivedAt))
    .limit(limit);
}

export async function getWebhookEvent(workspaceId: string, id: string) {
  const [event] = await db
    .select()
    .from(webhookEventsTable)
    .where(and(eq(webhookEventsTable.id, id), eq(webhookEventsTable.workspaceId, workspaceId)))
    .limit(1);
  return event ?? null;
}

export async function replayWebhookEventMock(workspaceId: string, id: string) {
  const existing = await getWebhookEvent(workspaceId, id);
  if (!existing) return null;

  const [event] = await db
    .update(webhookEventsTable)
    .set({
      status: "processed",
      processedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(webhookEventsTable.id, existing.id))
    .returning();

  return event;
}

export async function listDeadLetterCount(workspaceId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(deadLetterEventsTable)
    .where(eq(deadLetterEventsTable.workspaceId, workspaceId));
  return Number(row?.total ?? 0);
}
