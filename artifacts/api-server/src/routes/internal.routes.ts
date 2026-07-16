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
  webhookEventsTable,
} from "@workspace/db";
import { dispatchWhatsAppWebhook } from "../modules/integrations/adapters/whatsapp.adapter";
import { dispatchInstagramWebhook } from "../modules/integrations/adapters/instagram.adapter";
import { dispatchMessengerWebhook } from "../modules/integrations/adapters/messenger.adapter";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { runAgentReply } from "../lib/agent-reply";
import { runExpireGrantsJob } from "../jobs/expire-grants";
import { emitWorkspaceEvent } from "../lib/events";
import { notifyWorkspace } from "../services/notifications";
import { resolveWhatsAppConversationRecipient } from "../modules/integrations/whatsapp-contact-identity";
import { writeAgentStatus } from "../modules/conversations/lifecycle";

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

  // Reset webhook_events stuck in processing > 10 minutes back to received
  await db.execute(sql`
    UPDATE webhook_events
    SET status = 'received'
    WHERE status = 'processing'
      AND received_at < NOW() - INTERVAL '10 minutes'
  `);

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
      AND created_at < NOW() - INTERVAL '10 minutes'
  `);

  res.status(200).json({ updated: result.rowCount ?? 0 });
});

// ─── تذكير التصعيدات الراكدة (SLA) — G1 (15 يوليو 2026) ──────────────────────────────
// applyEscalationIfNeeded (أدناه) يُشعر التاجر مرّة واحدة عند تحوّل المحادثة لـhuman، لكن لا شيء
// يلاحقه لو تركها. تدقيق آخر 24س رصد تصعيدات كثيرة بلا ردّ بشري خلال ساعة — فجوة «إغلاق الحلقة»
// لا أمانة الوكيل (نصوص «سأحوّل/حوّلت» هي حرّاسنا نفسها، والتصعيد يحصل فعلاً). هذا الـsweep
// (يستدعيه الـworker كل 5د ضمن runCleanup) يُعيد تذكير التاجر بالمحادثات المصعّدة الراكدة بلا ردّ
// بشري (user/outbound) منذ أكثر من SLA دقيقة، مع تهدئة عبر علامة domain_event حتى لا يتكرّر كل
// دورة. READ + notify فقط (بلا توليد ردّ للعميل) — لا يمسّ حلقة الردّ ولا يخاطر بها.
const ESCALATION_SLA_MINUTES = Number(process.env.ESCALATION_SLA_MINUTES ?? "20");
const ESCALATION_REMINDER_COOLDOWN_MINUTES = Number(process.env.ESCALATION_REMINDER_COOLDOWN_MINUTES ?? "60");

router.post("/escalation-sla-sweep", async (req: Request, res: Response): Promise<void> => {
  if (!requireInternalSecret(req, res)) return;

  // مرشّحون: مصعّدة للبشر، غير محلولة/مغلقة، وآخر رسالة فيها ليست ردّ تاجر بشري (user/outbound)
  // وأقدم من SLA، ولم تُذكَّر خلال فترة التهدئة. LATERAL يجلب آخر رسالة لكل محادثة (مجموعة human صغيرة).
  const candidates = await db.execute<{ id: string; workspace_id: string }>(sql`
    SELECT c.id, c.workspace_id
    FROM conversations c
    JOIN LATERAL (
      SELECT m.sender_type, m.direction, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) lm ON TRUE
    WHERE c.agent_status = 'human'
      AND c.resolved_at IS NULL
      AND c.closed_at IS NULL
      AND lm.created_at < NOW() - (${ESCALATION_SLA_MINUTES}::int * INTERVAL '1 minute')
      AND NOT (lm.direction = 'outbound' AND lm.sender_type = 'user')
      AND NOT EXISTS (
        SELECT 1 FROM domain_events de
        WHERE de.entity_id = c.id
          AND de.event_type = 'conversation.escalation_reminded'
          AND de.created_at > NOW() - (${ESCALATION_REMINDER_COOLDOWN_MINUTES}::int * INTERVAL '1 minute')
      )
    LIMIT 200
  `);

  let reminded = 0;
  for (const row of candidates.rows) {
    await notifyWorkspace({
      workspaceId: row.workspace_id,
      type: "escalation_stale",
      titleAr: "محادثة مُصعّدة تنتظر ردّك",
      bodyAr: "هناك محادثة عميل حُوِّلت للمتابعة البشرية ولم يُرَدّ عليها بعد. افتح الوارد وأكمل مع العميل.",
      link: `/inbox?conversation=${row.id}`,
    }).catch((err) => logger.warn({ err, conversationId: row.id }, "escalation SLA reminder notify failed"));
    // علامة تهدئة (status=done فلا يلتقطها الـworker). نفس أعمدة إدراج domain_events المُثبتة.
    await db.execute(sql`
      INSERT INTO domain_events (workspace_id, event_type, entity_type, entity_id, payload, status)
      VALUES (${row.workspace_id}, 'conversation.escalation_reminded', 'conversation', ${row.id}, '{}'::jsonb, 'done')
    `);
    reminded += 1;
  }

  res.status(200).json({ ok: true, candidates: candidates.rows.length, reminded });
});

// إصلاح (10 يوليو 2026): نفس بق «تصعيد حقيقي لكن استجابة تقول false + صفر إشعار للتاجر» اتكرّر
// مرّتين مستقلّتين (فرع القناة المفقودة، فرع مستلم واتساب غير محلول) بعد إصلاح فرع الردّ الفارغ —
// اكتشفه اختبار حمل آلي حقيقي (محادثات فعلية عبر هذا المسار بالذات، لا محاكاة). استخرجناه لدالة
// واحدة بدل تكرار نفس المنطق في كل «مخرج مبكر» بالمسار — يمنع ظهور نسخة رابعة منسية لاحقاً.
// يُطبَّق التصعيد فقط عند shouldEscalate=true، ويُشعَر التاجر مرّة واحدة فقط عند *تحوّل* المحادثة
// لحالة human فعلاً (لا مع كل رسالة في محادثة متصعّدة أصلاً) — نفس دلالة الفرع الأصلي بالضبط.
async function applyEscalationIfNeeded(params: {
  workspaceId: string;
  conversationId: string;
  shouldEscalate: boolean;
  wasAlreadyHuman: boolean;
}): Promise<void> {
  if (!params.shouldEscalate) return;
  await writeAgentStatus({ conversationId: params.conversationId, workspaceId: params.workspaceId, agentStatus: "human" });
  if (params.wasAlreadyHuman) return;
  await notifyWorkspace({
    workspaceId: params.workspaceId,
    type: "conversation.needs_human",
    titleAr: "محادثة تحتاج تدخل",
    bodyAr: "لم يتمكن الوكيل من الرد، وتم تحويل المحادثة لمراجعة الفريق.",
    link: `/inbox?conversation=${params.conversationId}`,
  }).catch((err) => logger.warn({ err, conversationId: params.conversationId }, "Failed to notify workspace of escalation"));
  emitWorkspaceEvent({
    workspaceId: params.workspaceId,
    type: "conversation.needs_human",
    entityType: "conversation",
    entityId: params.conversationId,
    payload: { conversationId: params.conversationId },
  });
}

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
      .select({ id: aiAgentsTable.id, status: aiAgentsTable.status, createdBy: aiAgentsTable.createdBy, name: aiAgentsTable.name })
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
        contactId: conversationsTable.contactId,
        contactChannelId: conversationsTable.contactChannelId,
        channelAccountId: conversationsTable.channelAccountId,
        externalThreadId: conversationsTable.externalThreadId,
        channel: conversationsTable.channel,
        agentStatus: conversationsTable.agentStatus,
        needsHuman: conversationsTable.needsHuman,
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

    const wasAlreadyHuman = conversation.agentStatus === "human";
    const replyText = agentReply.reply.trim();
    if (!replyText) {
      // ردّ فارغ من runAgentReply — تصعيد حقيقي إن قرّره (نفاد رصيد، رصيد نموذج مؤقت، إلخ)،
      // يُطبَّق ويُبلَّغ التاجر عبر applyEscalationIfNeeded أدناه (لا صمت، لا ادّعاء بلا أثر).
      await applyEscalationIfNeeded({ workspaceId, conversationId, shouldEscalate: agentReply.shouldEscalate, wasAlreadyHuman });
      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: agentReply.shouldEscalate,
        toolResults: agentReply.toolResults,
        outboxEventId: null,
      });
      return;
    }

    if (!conversation.channelAccountId || !conversation.externalThreadId) {
      // إصلاح (10 يوليو 2026): كان shouldEscalate ثابتاً false هنا بلا أي إشعار للتاجر — فمحادثة
      // بلا قناة موصولة (بيانات ناقصة، أو اختبار) تُخفي تصعيداً حقيقياً (نفاد رصيد، فشل أداة، طلب
      // عميل صريح) تماماً؛ اكتشفه اختبار حمل آلي حقيقي (3 سيناريوهات مستقلة أكّدته). الوكيل ما زال
      // لا يقدر يرسل رداً فعلياً هنا (لا وجهة)، لكن حالة التصعيد الحقيقية والإشعار يجب ألا يضيعا.
      await applyEscalationIfNeeded({ workspaceId, conversationId, shouldEscalate: agentReply.shouldEscalate, wasAlreadyHuman });
      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: agentReply.shouldEscalate,
        toolResults: agentReply.toolResults,
        outboxEventId: null,
      });
      return;
    }

    // PD-2 fix: أدرج رسالة الوكيل في messages وأبثّها عبر SSE قبل الإضافة لـoutbox
    // PD-7 fix: senderId لرسائل الوكيل = null دائماً — العمود مرتبط بمفتاح أجنبي على users،
    // ومعرّف الوكيل من ai_agents يكسر القيد ويُسقط الرد كاملاً. هوية الوكيل في senderType+senderName+source.
    const isWhatsAppConversation = conversation.channel === "whatsapp" || conversation.channel === "whatsapp_api";
    let whatsappRecipient: Awaited<ReturnType<typeof resolveWhatsAppConversationRecipient>> | null = null;
    if (isWhatsAppConversation) {
      whatsappRecipient = await resolveWhatsAppConversationRecipient({
        workspaceId,
        channelAccountId: conversation.channelAccountId,
        contactId: conversation.contactId,
        contactChannelId: conversation.contactChannelId,
        externalThreadId: conversation.externalThreadId,
      });
      if (!whatsappRecipient.ok) {
        logger.warn({ workspaceId, conversationId, code: whatsappRecipient.code }, "Agent reply has no sendable WhatsApp recipient");
        // نفس إصلاح فرع القناة المفقودة أعلاه — لا وجهة إرسال هنا أيضاً، لكن التصعيد الحقيقي
        // وإشعار التاجر يجب ألا يضيعا بحجة تعذّر تحديد المستلم.
        await applyEscalationIfNeeded({ workspaceId, conversationId, shouldEscalate: agentReply.shouldEscalate, wasAlreadyHuman });
        res.status(200).json({
          success: true,
          runId: agentReply.runId,
          shouldEscalate: agentReply.shouldEscalate,
          toolResults: agentReply.toolResults,
          outboxEventId: null,
        });
        return;
      }
    }

    let outboxEventId: string | null = null;
    try {
      const [agentMessage] = await db
        .insert(messagesTable)
        .values({
          conversationId,
          workspaceId,
          content: replyText,
          direction: "outbound",
          senderType: "agent",
          senderId: null,
          senderName: agent.name,
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
            to: whatsappRecipient?.ok ? whatsappRecipient.to : conversation.externalThreadId,
            ...(whatsappRecipient?.ok ? { recipientIdentityType: whatsappRecipient.identityType } : {}),
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
      outboxEventId = event?.id ?? null;
    } catch (saveErr) {
      // PD-7 defense-in-depth (محمية #10): لا تُسقِط العميل بصمت لو فشل الحفظ/الإدراج.
      // صعّد المحادثة لبشري وأبلغ الفريق، وأبلغ الـworker بالتصعيد (done لا failed) فلا تتكرّر الحلقة.
      logger.error({ err: saveErr, workspaceId, conversationId, agentId }, "Failed to persist/queue agent reply — escalating to human");
      await writeAgentStatus({ conversationId, workspaceId, agentStatus: "human" }).catch(() => {});
      await notifyWorkspace({
        workspaceId,
        type: "conversation.needs_human",
        titleAr: "محادثة تحتاج تدخل",
        bodyAr: "تعذّر إرسال رد الوكيل تلقائياً، وتم تحويل المحادثة لمراجعة الفريق.",
        link: `/inbox?conversation=${conversationId}`,
      }).catch((err) => logger.warn({ err, conversationId }, "Failed to notify workspace of escalation"));
      emitWorkspaceEvent({ workspaceId, type: "conversation.needs_human", entityType: "conversation", entityId: conversationId, payload: { conversationId } });
      res.status(200).json({
        success: true,
        runId: agentReply.runId,
        shouldEscalate: true,
        toolResults: agentReply.toolResults,
        outboxEventId: null,
      });
      return;
    }

    if (agentReply.shouldEscalate) {
      await writeAgentStatus({ conversationId, workspaceId, agentStatus: "human" });
      await notifyWorkspace({
        workspaceId,
        type: "conversation.needs_human",
        titleAr: "محادثة تحتاج تدخل",
        bodyAr: "الوكيل أرسل رداً مؤقتاً وحوّل المحادثة لمراجعة الفريق.",
        link: `/inbox?conversation=${conversationId}`,
      }).catch((err) => logger.warn({ err, conversationId }, "Failed to notify workspace of escalation"));
      emitWorkspaceEvent({ workspaceId, type: "conversation.needs_human", entityType: "conversation", entityId: conversationId, payload: { conversationId } });
    }

    res.status(200).json({
      success: true,
      runId: agentReply.runId,
      shouldEscalate: agentReply.shouldEscalate,
      toolResults: agentReply.toolResults,
      outboxEventId,
    });
  } catch (err) {
    logger.error({ err, workspaceId, conversationId, agentId }, "Internal agent reply failed");
    res.status(500).json({ success: false, error: "Internal agent reply failed" });
  }
});

const dispatchWebhookSchema = z.object({ webhookEventId: z.string().uuid() });

router.post("/dispatch-webhook-event", async (req: Request, res: Response): Promise<void> => {
  if (!requireInternalSecret(req, res)) return;

  const parsed = dispatchWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { webhookEventId } = parsed.data;

  const [row] = await db
    .select({ id: webhookEventsTable.id, payload: webhookEventsTable.payload })
    .from(webhookEventsTable)
    .where(eq(webhookEventsTable.id, webhookEventId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "webhook_events row not found", webhookEventId });
    return;
  }

  const objectType = (row.payload as any)?.object;

  try {
    let result;
    if (objectType === "whatsapp_business_account") {
      result = await dispatchWhatsAppWebhook(row.payload);
    } else if (objectType === "instagram") {
      result = await dispatchInstagramWebhook(row.payload);
    } else if (objectType === "page") {
      result = await dispatchMessengerWebhook(row.payload);
    } else {
      await db
        .update(webhookEventsTable)
        .set({ status: "failed", errorMessage: `unsupported object type: ${objectType}`, processedAt: new Date() })
        .where(eq(webhookEventsTable.id, webhookEventId));
      res.status(200).json({ handled: false, messagesCreated: 0, statusesUpdated: 0, reason: "unsupported_object_type" });
      return;
    }

    await db
      .update(webhookEventsTable)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookEventsTable.id, webhookEventId));

    res.status(200).json({ handled: result.handled, messagesCreated: result.messagesCreated, statusesUpdated: result.statusesUpdated });
  } catch (err) {
    logger.error({ err, webhookEventId }, "dispatch-webhook-event: adapter threw");
    res.status(500).json({ error: "adapter_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// POST /internal/jobs/expire-grants — يشغّله Cloud Scheduler يومياً (أو يدوياً)
router.post("/jobs/expire-grants", async (req: Request, res: Response): Promise<void> => {
  if (!requireInternalSecret(req, res)) return;
  try {
    const result = await runExpireGrantsJob();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "expire-grants-job: failed via HTTP");
    res.status(500).json({ ok: false, error: "job failed" });
  }
});

export default router;
