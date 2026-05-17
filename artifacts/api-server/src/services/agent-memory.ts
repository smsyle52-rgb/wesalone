import { and, desc, eq, isNull } from "drizzle-orm";
import {
  agentMemorySnapshotsTable,
  messagesTable,
  type AgentMemoryTurn,
} from "@workspace/db";
import { db } from "@workspace/db";
import { runAI, getDefaultModel } from "../lib/ai-provider";
import { logger } from "../lib/logger";

const MAX_TURNS = 20;
const ROTATE_THRESHOLD = 6000;

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function estimateSnapshotTokens(summary: string | null, turns: AgentMemoryTurn[]): number {
  return estimateTokens([summary ?? "", ...turns.map((turn) => turn.content)].join("\n"));
}

function normalizeTurn(turn: AgentMemoryTurn): AgentMemoryTurn {
  return {
    role: turn.role,
    content: turn.content.slice(0, 8000),
    ts: turn.ts,
    message_id: turn.message_id ?? null,
  };
}

function condition(conversationId: string, agentId?: string | null) {
  return agentId
    ? and(eq(agentMemorySnapshotsTable.conversationId, conversationId), eq(agentMemorySnapshotsTable.agentId, agentId))
    : and(eq(agentMemorySnapshotsTable.conversationId, conversationId), isNull(agentMemorySnapshotsTable.agentId));
}

function messageToTurn(message: typeof messagesTable.$inferSelect): AgentMemoryTurn {
  return {
    role: message.direction === "inbound" ? "user" : "assistant",
    content: message.content,
    ts: message.createdAt.toISOString(),
    message_id: message.id,
  };
}

async function buildFromMessages(workspaceId: string, conversationId: string, agentId?: string | null) {
  const messages = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.workspaceId, workspaceId), eq(messagesTable.conversationId, conversationId)))
    .orderBy(desc(messagesTable.createdAt))
    .limit(MAX_TURNS);

  const turns = messages.reverse().map(messageToTurn);
  const lastMessage = messages[messages.length - 1] ?? null;
  const tokenEstimate = estimateSnapshotTokens(null, turns);
  const [snapshot] = await db
    .insert(agentMemorySnapshotsTable)
    .values({
      workspaceId,
      conversationId,
      agentId: agentId ?? null,
      summary: null,
      recentTurns: turns,
      lastMessageId: lastMessage?.id ?? null,
      tokenEstimate,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [agentMemorySnapshotsTable.conversationId, agentMemorySnapshotsTable.agentId],
      set: {
        recentTurns: turns,
        lastMessageId: lastMessage?.id ?? null,
        tokenEstimate,
        updatedAt: new Date(),
      },
    })
    .returning();

  return snapshot;
}

export async function loadContext(workspaceId: string, conversationId: string, agentId?: string | null) {
  const [snapshot] = await db
    .select()
    .from(agentMemorySnapshotsTable)
    .where(and(eq(agentMemorySnapshotsTable.workspaceId, workspaceId), condition(conversationId, agentId)))
    .limit(1);

  if (snapshot) {
    return {
      snapshot,
      summary: snapshot.summary,
      recentTurns: snapshot.recentTurns,
      tokenEstimate: snapshot.tokenEstimate,
    };
  }

  const created = await buildFromMessages(workspaceId, conversationId, agentId);
  return {
    snapshot: created,
    summary: created.summary,
    recentTurns: created.recentTurns,
    tokenEstimate: created.tokenEstimate,
  };
}

export async function appendTurn(
  workspaceId: string,
  conversationId: string,
  agentId: string | null | undefined,
  turn: AgentMemoryTurn,
) {
  const context = await loadContext(workspaceId, conversationId, agentId);
  const recentTurns = [...context.recentTurns, normalizeTurn(turn)].slice(-MAX_TURNS);
  const tokenEstimate = estimateSnapshotTokens(context.summary, recentTurns);

  const [snapshot] = await db
    .update(agentMemorySnapshotsTable)
    .set({
      recentTurns,
      lastMessageId: turn.message_id ?? context.snapshot.lastMessageId ?? null,
      tokenEstimate,
      updatedAt: new Date(),
    })
    .where(and(eq(agentMemorySnapshotsTable.workspaceId, workspaceId), eq(agentMemorySnapshotsTable.id, context.snapshot.id)))
    .returning();

  return snapshot;
}

export async function rotate(workspaceId: string, conversationId: string, agentId?: string | null) {
  const context = await loadContext(workspaceId, conversationId, agentId);
  if (context.tokenEstimate <= ROTATE_THRESHOLD || context.recentTurns.length < 12) return { rotated: false, snapshot: context.snapshot };

  const olderTurns = context.recentTurns.slice(0, 10);
  const remainingTurns = context.recentTurns.slice(10);
  const existingSummary = context.summary ? `ملخص سابق:\n${context.summary}\n\n` : "";
  const transcript = olderTurns.map((turn) => `[${turn.role}]: ${turn.content}`).join("\n");

  try {
    const output = await runAI({
      model: getDefaultModel(),
      taskType: "summarize",
      messages: [
        { role: "system", content: "لخص هذا الجزء من المحادثة كسياق قصير ودقيق لوكيل خدمة العملاء. لا تضف معلومات غير موجودة." },
        { role: "user", content: `${existingSummary}المحادثة:\n${transcript}` },
      ],
    });
    const summary = output.content.trim();
    const compressedTurn: AgentMemoryTurn = {
      role: "system",
      content: `ملخص الذاكرة السابقة: ${summary}`,
      ts: new Date().toISOString(),
      message_id: null,
    };
    const recentTurns = [compressedTurn, ...remainingTurns].slice(-MAX_TURNS);
    const tokenEstimate = estimateSnapshotTokens(summary, recentTurns);
    const [snapshot] = await db
      .update(agentMemorySnapshotsTable)
      .set({ summary, recentTurns, tokenEstimate, updatedAt: new Date() })
      .where(and(eq(agentMemorySnapshotsTable.workspaceId, workspaceId), eq(agentMemorySnapshotsTable.id, context.snapshot.id)))
      .returning();
    return { rotated: true, snapshot };
  } catch (err) {
    logger.warn({ err, conversationId, agentId }, "Failed to rotate agent memory");
    return { rotated: false, snapshot: context.snapshot };
  }
}

export async function clear(workspaceId: string, conversationId: string, agentId?: string | null) {
  await db
    .delete(agentMemorySnapshotsTable)
    .where(and(eq(agentMemorySnapshotsTable.workspaceId, workspaceId), condition(conversationId, agentId)));
}

export function shouldRotate(tokenEstimate: number): boolean {
  return tokenEstimate > ROTATE_THRESHOLD;
}
