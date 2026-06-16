import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiAgentsTable,
  conversationsTable,
  messagesTable,
  outboxEventsTable,
} from "@workspace/db";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { runAgentReply } from "../lib/agent-reply";
import { emitWorkspaceEvent } from "../lib/events";
import { notifyWorkspace } from "../services/notifications";

const router = Router();

const agentReplySchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid(),
  agentId: z.string().uuid(),
  domainEventId: z.string().optional(),
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

  const { workspaceId, conversationId, agentId, domainEventId } = parsed.data;

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
        channel: conversationsTable.channel,
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

    const replyText = agentReply.reply.trim();
    if (!replyText) {
      if (agentReply.shouldEscalate) {
        await db
          .update(conversationsTable)
          .set({ agentStatus: "human", updatedAt: new Date() })
          .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, workspaceId)));
        await notifyWorkspace({
          workspaceId,
          type: "conversation.needs_human",
          titleAr: "محادثة تحتاج تدخل",
          bodyAr: "لم يتمكن الوكيل من الرد، وتم تحويل المحادثة لمراجعة الفريق.",
          link: `/inbox?conversation=${conversationId}`,
        }).catch((err) => logger.warn({ err, conversationId }, "Failed to notify workspace of escalation"));
      }

      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: true,
        toolResults: agentReply.toolResults,
        outboxEventId: null,
      });
      return;
    }

    if (!conversation.channelAccountId || !conversation.externalThreadId) {
      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: false,
        toolResults: agentReply.toolResults,
        outboxEventId: null,
      });
      return;
    }

    // PD-2 fix: أدرج رسالة الوكيل في messages وأبثّها عبر SSE قبل الإضافة لـoutbox
    const [agentMessage] = await db
      .insert(messagesTable)
      .values({
        conversationId,
        workspaceId,
        content: replyText,
        direction: "outbound",
        senderType: "agent",
        senderId: agentId,
        source: "ai",
        contentType: "text",
        isPrivateNote: false,
        deliveryStatus: "pending",
        sentAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: messagesTable.id });

    if (agentMessage) {
      emitWorkspaceEvent({
        workspaceId,
        type: "message.new",
        entityType: "message",
        entityId: agentMessage.id,
        payload: { conversationId, direction: "outbound", source: "ai" },
      });
    }

    const outboxEventType = conversation.channel === "instagram"
      ? "message.send.instagram.text"
      : conversation.channel === "messenger"
        ? "message.send.messenger.text"
        : "message.send.whatsapp.text";

    const [event] = await db
      .insert(outboxEventsTable)
      .values({
        workspaceId,
        eventType: outboxEventType,
        entityType: "conversation",
        entityId: conversationId,
        idempotencyKey: domainEventId ? `de:${domainEventId}` : `auto:${agentId}:${agentReply.runId}`,
        payload: {
          channelAccountId: conversation.channelAccountId,
          conversationId,
          to: conversation.externalThreadId,
          body: replyText,
          aiRunId: agentReply.runId,
          autoReply: true,
          messageId: agentMessage?.id,
        },
        status: "pending",
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: outboxEventsTable.id });

    if (agentReply.shouldEscalate) {
      await db
        .update(conversationsTable)
        .set({ agentStatus: "human", updatedAt: new Date() })
        .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.workspaceId, workspaceId)));
      await notifyWorkspace({
        workspaceId,
        type: "conversation.needs_human",
        titleAr: "محادثة تحتاج تدخل",
        bodyAr: "الوكيل أرسل رداً مؤقتاً وحوّل المحادثة لمراجعة الفريق.",
        link: `/inbox?conversation=${conversationId}`,
      }).catch((err) => logger.warn({ err, conversationId }, "Failed to notify workspace of escalation"));
    }

    res.status(200).json({
      success: true,
      runId: agentReply.runId,
      shouldEscalate: agentReply.shouldEscalate,
      toolResults: agentReply.toolResults,
      outboxEventId: event?.id ?? null,
    });
  } catch (err) {
    logger.error({ err, workspaceId, conversationId, agentId }, "Internal agent reply failed");
    res.status(500).json({ success: false, error: "Internal agent reply failed" });
  }
});

export default router;
