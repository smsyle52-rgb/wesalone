import { and, eq } from "drizzle-orm";
import { db, conversationsTable } from "@workspace/db";

/**
 * W3-T1: the only place in api-server that writes conversations.status or
 * conversations.agent_status. Deliberately narrow — this centralizes the
 * WRITE mechanism only. Each call site keeps its own surrounding logic
 * (audit logging, notifications, event emission, transition validation)
 * exactly as it was; this is a consolidation of the SQL, not a redesign of
 * when/why a transition happens. See PD-11's reactivate-emits-a-fresh-event
 * fix (already live in conversations.routes.ts's PATCH /:id/agent-status) —
 * that stays where it is, since it's specific to the user-facing reactivate
 * path, not something every agent_status write needs.
 *
 * outbox-worker is a separate deployable (no shared import path — it talks
 * to Postgres directly via pg.Pool, not this module) and has its own
 * equivalent single-writer consolidation for the writes that happen there.
 */

export type ConversationAgentStatus = "active" | "paused" | "human";

export async function writeAgentStatus(params: {
  conversationId: string;
  workspaceId: string;
  agentStatus: ConversationAgentStatus;
  extraFields?: Partial<{
    needsHuman: boolean;
    escalationReason: string | null;
    agentPausedUntil: Date | null;
    consecutiveAgentReplies: number;
  }>;
}): Promise<typeof conversationsTable.$inferSelect | undefined> {
  const [conversation] = await db
    .update(conversationsTable)
    .set({
      agentStatus: params.agentStatus,
      updatedAt: new Date(),
      ...params.extraFields,
    })
    .where(and(
      eq(conversationsTable.id, params.conversationId),
      eq(conversationsTable.workspaceId, params.workspaceId),
    ))
    .returning();
  return conversation;
}

export async function writeConversationStatus(params: {
  conversationId: string;
  workspaceId: string;
  status: string;
  extraFields?: Record<string, unknown>;
}): Promise<typeof conversationsTable.$inferSelect | undefined> {
  const [conversation] = await db
    .update(conversationsTable)
    .set({
      status: params.status,
      updatedAt: new Date(),
      ...params.extraFields,
    })
    .where(and(
      eq(conversationsTable.id, params.conversationId),
      eq(conversationsTable.workspaceId, params.workspaceId),
    ))
    .returning();
  return conversation;
}
