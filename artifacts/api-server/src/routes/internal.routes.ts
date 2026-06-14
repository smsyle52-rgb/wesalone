import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiAgentsTable,
  conversationsTable,
  outboxEventsTable,
} from "@workspace/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { runAgentReply } from "../lib/agent-reply";

const router = Router();

const agentReplySchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid(),
  agentId: z.string().uuid(),
});

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireInternalSecret(req: Request, res: Response): boolean {
  if (!env.INTERNAL_SECRET) {
    res.status(503).json({ error: "INTERNAL_SECRET is not configured" });
    return false;
  }

  if (!secretMatches(req.get("X-Internal-Secret"), env.INTERNAL_SECRET)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

router.post("/cleanup-outbox", async (req: Request, res: Response): Promise<void> => {
  if (!requireInternalSecret(req, res)) return;

  const result = await db.execute(sql`
    UPDATE outbox_events
    SET status = 'failed'
    WHERE status IN ('processing', 'pending')
      AND created_at < NOW() - INTERVAL '5 minutes'
  `);

  const pendingResult = await db.execute<{ pending: string }>(sql`
    SELECT COUNT(*) as pending
    FROM domain_events
    WHERE status = 'pending'
  `);

  res.status(200).json({
    updated: result.rowCount ?? 0,
    pendingDomainEvents: Number(pendingResult.rows[0]?.pending ?? 0),
  });
});

router.post("/cleanup-domain-events", async (req: Request, res: Response): Promise<void> => {
  if (!requireInternalSecret(req, res)) return;

  const result = await db.execute(sql`
    UPDATE domain_events
    SET status = 'pending'
    WHERE status = 'processing'
      AND updated_at < NOW() - INTERVAL '10 minutes'
  `);

  res.status(200).json({ updated: result.rowCount ?? 0 });
});

router.post("/agent-reply", async (req: Request, res: Response): Promise<void> => {
  if (!requireInternalSecret(req, res)) return;

  const parsed = agentReplySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { workspaceId, conversationId, agentId } = parsed.data;

  try {
    const [agent] = await db
      .select({ id: aiAgentsTable.id, status: aiAgentsTable.status, createdBy: aiAgentsTable.createdBy })
      .from(aiAgentsTable)
      .where(and(eq(aiAgentsTable.id, agentId), eq(aiAgentsTable.workspaceId, workspaceId)))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: "AI agent not found" });
      return;
    }

    if (agent.status !== "active") {
      res.status(409).json({ error: "AI agent is not active" });
      return;
    }

    const [conversation] = await db
      .select({
        id: conversationsTable.id,
        channelAccountId: conversationsTable.channelAccountId,
        externalThreadId: conversationsTable.externalThreadId,
      })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, workspaceId)))
      .limit(1);

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const agentReply = await runAgentReply({
      workspaceId,
      conversationId,
      agentId,
      systemUserId: agent.createdBy,
    });

    if (agentReply.shouldEscalate) {
      await db
        .update(conversationsTable)
        .set({ agentStatus: "human", updatedAt: new Date() })
        .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, workspaceId)));

      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: true,
        outboxEventId: null,
      });
      return;
    }

    if (!conversation.channelAccountId || !conversation.externalThreadId) {
      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: false,
        outboxEventId: null,
      });
      return;
    }

    const [event] = await db
      .insert(outboxEventsTable)
      .values({
        workspaceId,
        eventType: "message.send.whatsapp.text",
        entityType: "conversation",
        entityId: conversationId,
        idempotencyKey: `auto:${agentId}:${agentReply.runId}`,
        payload: {
          channelAccountId: conversation.channelAccountId,
          conversationId,
          to: conversation.externalThreadId,
          body: agentReply.reply,
          aiRunId: agentReply.runId,
          autoReply: true,
        },
        status: "pending",
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: outboxEventsTable.id });

    res.status(200).json({
      success: true,
      runId: agentReply.runId,
      shouldEscalate: false,
      outboxEventId: event?.id ?? null,
    });
  } catch (err) {
    logger.error({ err, workspaceId, conversationId, agentId }, "Internal agent reply failed");
    res.status(500).json({ success: false, error: "Internal agent reply failed" });
  }
});

export default router;
