import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, asc, count, ilike, inArray, or, sql } from "drizzle-orm";
import {
  db, conversationsTable, messagesTable, contactsTable,
  contactChannelsTable, contactTimelineTable, workspaceMembershipsTable, usersTable,
  ticketsTable, outboxEventsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { emitWorkspaceEvent, publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";
import { fetchMetaMediaStream } from "../../services/meta-media";
import { resolveWhatsAppConversationRecipient } from "../integrations/whatsapp-contact-identity";

const router = Router();
router.use(requireSession);

const VALID_STATUSES = ["new", "open", "pending", "snoozed", "bot", "resolved", "closed"] as const;
type ConvStatus = typeof VALID_STATUSES[number];

const ALLOWED_TRANSITIONS: Record<ConvStatus, ConvStatus[]> = {
  new: ["open"],
  open: ["pending", "snoozed", "bot", "resolved"],
  pending: ["open"],
  snoozed: ["open"],
  bot: ["open"],
  resolved: ["open", "closed"],
  closed: [],
};

async function addContactTimeline(opts: {
  workspaceId: string;
  contactId: string | null | undefined;
  eventType: string;
  entityType: string;
  entityId: string;
  title: string;
  description?: string;
  createdBy?: string | null;
}) {
  if (!opts.contactId) return;
  try {
    await db.insert(contactTimelineTable).values({
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      eventType: opts.eventType,
      entityType: opts.entityType,
      entityId: opts.entityId,
      title: opts.title,
      description: opts.description,
      createdBy: opts.createdBy ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to add contact timeline event");
  }
}

const createConvSchema = z.object({
  contactId: z.string().uuid("معرف العميل غير صحيح").optional(),
  contactChannelId: z.string().uuid().optional(),
  channelAccountId: z.string().uuid().optional(),
  channel: z.enum(["manual", "whatsapp_manual", "whatsapp_api", "website_widget", "telegram", "instagram", "messenger", "voice", "whatsapp", "sms", "email", "webchat"]).default("manual"),
  subject: z.string().max(255).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  initialMessage: z.string().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().default(""),
  direction: z.enum(["outbound", "inbound", "internal"]).default("outbound"),
  isPrivateNote: z.boolean().default(false),
  contentType: z.enum(["text", "image", "audio", "document", "note"]).default("text"),
  source: z.enum(["manual", "paste", "widget", "api", "automation"]).default("manual"),
  mediaUrl: z.string().url("رابط الوسائط غير صحيح").optional(),
  mediaType: z.enum(["image", "video", "document", "audio"]).optional(),
  inReplyTo: z.string().uuid("معرف الرسالة المُقتبسة غير صحيح").optional(),
}).superRefine((data, ctx) => {
  const hasText = data.content.trim().length > 0;
  const hasMedia = Boolean(data.mediaUrl);
  if (!hasText && !hasMedia) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "محتوى الرسالة أو رابط الوسائط مطلوب", path: ["content"] });
  }
  if (hasMedia && !data.mediaType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "نوع الوسائط مطلوب عند إرسال رابط", path: ["mediaType"] });
  }
});

const updateConvSchema = z.object({
  subject: z.string().max(255).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  aiSummary: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  snoozedUntil: z.string().datetime().optional(),
});

const assignSchema = z.object({
  membershipId: z.string().uuid("معرف العضو غير صحيح").nullable(),
});

const agentStatusSchema = z.object({
  status: z.enum(["active", "paused", "human"]),
  pauseMinutes: z.number().int().min(1).max(1440).optional(),
});

const labelSchema = z.object({
  label: z.string().trim().min(1, "الوسم مطلوب").max(50, "الوسم طويل جداً"),
});

const importSchema = z.object({
  text: z.string().min(1, "نص المحادثة مطلوب").max(50000),
});

router.get("/", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = (req.query.status as string) || "";
  const search = (req.query.search as string) || "";
  const channel = (req.query.channel as string) || "";
  const assignee = (req.query.assignee as string) || "";
  const view = (req.query.view as string) || "";
  const label = (req.query.label as string) || "";
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(conversationsTable.workspaceId, activeWorkspaceId)];
  if (view === "mine") {
    conditions.push(eq(conversationsTable.assignedMembershipId, req.sessionUser.activeMembershipId));
  }
  if (view === "unassigned") {
    conditions.push(sql`${conversationsTable.assignedMembershipId} IS NULL`);
  }
  if (view === "open_tickets") {
    conditions.push(eq(ticketsTable.status, "open"));
  }
  if (view === "closed") {
    conditions.push(eq(conversationsTable.status, "closed"));
  }
  if (view === "sla_breached") {
    conditions.push(sql`${conversationsTable.unreadCount} > 0 AND ${conversationsTable.lastMessageAt} < now() - interval '30 minutes'`);
  }
  if (status) conditions.push(eq(conversationsTable.status, status));
  // فلتر القناة: واتساب مخزّن تاريخياً بقيمتين (whatsapp من الإنشاء اليدوي،
  // whatsapp_api من الـwebhook الحي) — فلتر «واتساب» يجب أن يلتقط كليهما،
  // وإلا يعرض صفر محادثات رغم امتلاء الوارد (عطل مكتشف بالاختبار الحي 3 يوليو).
  if (channel === "whatsapp" || channel === "whatsapp_api") {
    conditions.push(inArray(conversationsTable.channel, ["whatsapp", "whatsapp_api"]));
  } else if (channel) {
    conditions.push(eq(conversationsTable.channel, channel));
  }
  if (assignee === "unassigned") {
    conditions.push(sql`${conversationsTable.assignedMembershipId} IS NULL`);
  } else if (assignee) {
    conditions.push(eq(conversationsTable.assignedMembershipId, assignee));
  }
  if (label) {
    conditions.push(sql`${label} = ANY(${conversationsTable.labels})`);
  }
  if (search) {
    conditions.push(or(
      ilike(contactsTable.name, `%${search}%`),
      ilike(contactsTable.phone, `%${search}%`),
      ilike(conversationsTable.subject, `%${search}%`),
    )!);
  }

  const baseQuery = db
    .select({
      id: conversationsTable.id,
      displayId: conversationsTable.displayId,
      channel: conversationsTable.channel,
      status: conversationsTable.status,
      lifecycleState: conversationsTable.lifecycleState,
      priority: conversationsTable.priority,
      subject: conversationsTable.subject,
      lastMessage: conversationsTable.lastMessage,
      lastMessageAt: conversationsTable.lastMessageAt,
      unreadCount: conversationsTable.unreadCount,
      needsHuman: conversationsTable.needsHuman,
      escalationReason: conversationsTable.escalationReason,
      labels: conversationsTable.labels,
      waitingSince: conversationsTable.waitingSince,
      agentStatus: conversationsTable.agentStatus,
      assignedMembershipId: conversationsTable.assignedMembershipId,
      createdAt: conversationsTable.createdAt,
      contactId: conversationsTable.contactId,
      contactName: contactsTable.name,
      contactPhone: contactsTable.phone,
      contactCompany: contactsTable.company,
      ticketId: ticketsTable.id,
      ticketNumber: ticketsTable.number,
      ticketStatus: ticketsTable.status,
    })
    .from(conversationsTable)
    .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
    .leftJoin(ticketsTable, and(eq(ticketsTable.conversationId, conversationsTable.id), eq(ticketsTable.workspaceId, activeWorkspaceId)))
    .where(and(...conditions));

  const [rows, [{ total }], countRows] = await Promise.all([
    baseQuery
      .orderBy(desc(conversationsTable.lastMessageAt), desc(conversationsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() })
      .from(conversationsTable)
      .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
      .leftJoin(ticketsTable, and(eq(ticketsTable.conversationId, conversationsTable.id), eq(ticketsTable.workspaceId, activeWorkspaceId)))
      .where(and(...conditions)),
    db.select({ status: conversationsTable.status, cnt: count() })
      .from(conversationsTable)
      .where(eq(conversationsTable.workspaceId, activeWorkspaceId))
      .groupBy(conversationsTable.status),
  ]);

  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.status] = Number(r.cnt);

  res.json({ conversations: rows, total: Number(total), page, limit, counts });
});

router.post("/", requirePermission("conversations:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createConvSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId, userId } = req.sessionUser;
  const { contactId, contactChannelId, channelAccountId, channel, subject, priority, initialMessage } = parsed.data;

  try {
    let contactName = "بدون عميل";
    if (contactId) {
      const [contact] = await db.select({ name: contactsTable.name })
        .from(contactsTable)
        .where(and(eq(contactsTable.id, contactId), eq(contactsTable.workspaceId, activeWorkspaceId)))
        .limit(1);
      if (!contact) { res.status(404).json({ error: "العميل غير موجود" }); return; }
      contactName = contact.name;
    }

    const [conversation] = await db.insert(conversationsTable).values({
      workspaceId: activeWorkspaceId,
      contactId: contactId ?? null,
      contactChannelId: contactChannelId ?? null,
      channelAccountId: channelAccountId ?? null,
      channel,
      subject: subject ?? null,
      priority,
      status: "new",
    }).returning();

    let firstMessage = null;
    if (initialMessage?.trim()) {
      const [msg] = await db.insert(messagesTable).values({
        conversationId: conversation.id,
        workspaceId: activeWorkspaceId,
        content: initialMessage.trim(),
        direction: "outbound",
        senderType: "user",
        senderId: userId,
        source: "manual",
        contentType: "text",
        deliveryStatus: "sent",
        sentAt: new Date(),
      }).returning();
      firstMessage = msg;

      await db.update(conversationsTable)
        .set({ lastMessage: initialMessage.trim(), lastMessageAt: new Date(), status: "open", updatedAt: new Date() })
        .where(and(eq(conversationsTable.id, conversation.id), eq(conversationsTable.workspaceId, activeWorkspaceId)));
      conversation.status = "open";
      conversation.lastMessage = initialMessage.trim();
    }

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "conversation",
      entityId: conversation.id,
      entityLabel: `${channel} — ${contactName}`,
      newData: { channel, contactId: contactId ?? null, status: "new", priority },
    });

    await addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId,
      eventType: "conversation_created",
      entityType: "conversation",
      entityId: conversation.id,
      title: `تم إنشاء محادثة جديدة`,
      description: subject ?? undefined,
      createdBy: userId,
    });

    await publishDomainEvent({
      eventType: "conversation.opened",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { channel, contactId: contactId ?? null, priority, status: conversation.status },
      sessionUser: req.sessionUser,
    });

    res.status(201).json({ conversation, firstMessage });
  } catch (err) {
    logger.error({ err }, "Failed to create conversation");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.get("/:id", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;

  const [conv] = await db.select({
    id: conversationsTable.id,
    displayId: conversationsTable.displayId,
    channel: conversationsTable.channel,
    status: conversationsTable.status,
    lifecycleState: conversationsTable.lifecycleState,
    priority: conversationsTable.priority,
    labels: conversationsTable.labels,
    subject: conversationsTable.subject,
    lastMessage: conversationsTable.lastMessage,
    lastMessageAt: conversationsTable.lastMessageAt,
    unreadCount: conversationsTable.unreadCount,
    assignedMembershipId: conversationsTable.assignedMembershipId,
    contactChannelId: conversationsTable.contactChannelId,
    channelAccountId: conversationsTable.channelAccountId,
    externalThreadId: conversationsTable.externalThreadId,
    snoozedUntil: conversationsTable.snoozedUntil,
    resolvedAt: conversationsTable.resolvedAt,
    closedAt: conversationsTable.closedAt,
    aiSummary: conversationsTable.aiSummary,
    needsHuman: conversationsTable.needsHuman,
    escalationReason: conversationsTable.escalationReason,
    // PD-11 fix: الواجهة تحتاج حالة الوكيل لإظهار الشارة وزر «إعادة/أوقف الوكيل»؛ كانت مفقودة من البيانات.
    agentStatus: conversationsTable.agentStatus,
    agentPausedUntil: conversationsTable.agentPausedUntil,
    consecutiveAgentReplies: conversationsTable.consecutiveAgentReplies,
    waitingSince: conversationsTable.waitingSince,
    firstReplyCreatedAt: conversationsTable.firstReplyCreatedAt,
    createdAt: conversationsTable.createdAt,
    updatedAt: conversationsTable.updatedAt,
    contactId: contactsTable.id,
    contactName: contactsTable.name,
    contactPhone: contactsTable.phone,
    contactEmail: contactsTable.email,
    contactCompany: contactsTable.company,
  })
    .from(conversationsTable)
    .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  const [messagesDesc, contactChannels, assignedMember, activeTicket] = await Promise.all([
    // PD-2 fix: اجلب أحدث 100 رسالة (desc) ثم اعكسها للعرض — `asc.limit(100)` كان يجلب
    // أقدم 100 رسالة فيُخفي الرسائل الجديدة كلياً في المحادثات الطويلة (>100 رسالة).
    db.select().from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conv.id), eq(messagesTable.workspaceId, activeWorkspaceId)))
      .orderBy(desc(messagesTable.sentAt))
      .limit(100),
    conv.contactId ? db.select().from(contactChannelsTable)
      .where(and(eq(contactChannelsTable.contactId, conv.contactId), eq(contactChannelsTable.workspaceId, activeWorkspaceId)))
      : Promise.resolve([] as (typeof contactChannelsTable.$inferSelect)[]),
    conv.assignedMembershipId ? db.select({
      id: workspaceMembershipsTable.id,
      userId: usersTable.id,
      name: usersTable.name,
    }).from(workspaceMembershipsTable)
      .leftJoin(usersTable, eq(workspaceMembershipsTable.userId, usersTable.id))
      .where(and(eq(workspaceMembershipsTable.id, conv.assignedMembershipId), eq(workspaceMembershipsTable.workspaceId, activeWorkspaceId)))
      .limit(1) : Promise.resolve([] as { id: string; userId: string | null; name: string | null }[]),
    db.select({
      id: ticketsTable.id,
      number: ticketsTable.number,
      status: ticketsTable.status,
      priority: ticketsTable.priority,
      title: ticketsTable.title,
    }).from(ticketsTable)
      .where(and(eq(ticketsTable.conversationId, conv.id), eq(ticketsTable.workspaceId, activeWorkspaceId)))
      .orderBy(desc(ticketsTable.createdAt))
      .limit(1),
  ]);

  // PD-2 fix: اعكس الرسائل المجلوبة تنازلياً لتُعرَض تصاعدياً (الأقدم→الأحدث) في الخيط.
  const messages = messagesDesc.slice().reverse();

  const whatsappChannel = contactChannels.find(
    (c) => c.channelType === "whatsapp" || c.channelType === "whatsapp_manual" || c.channelType === "phone"
  );
  const waLink = whatsappChannel?.normalizedIdentifier
    ? `https://wa.me/${whatsappChannel.normalizedIdentifier.replace("+", "")}`
    : null;

  res.json({
    conversation: conv,
    messages,
    contactChannels,
    assignedMember: assignedMember[0] ?? null,
    ticket: activeTicket[0] ?? null,
    waLink,
  });
});

router.patch("/:id", requirePermission("conversations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateConvSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId } = req.sessionUser;
  const [existing] = await db.select({ id: conversationsTable.id, contactId: conversationsTable.contactId })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.aiSummary !== undefined) updates.aiSummary = parsed.data.aiSummary;

  const [conv] = await db.update(conversationsTable)
    .set(updates)
    .where(and(eq(conversationsTable.id, existing.id), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "conversation",
    entityId: conv.id,
    entityLabel: conv.subject ?? conv.id.slice(0, 8),
    newData: parsed.data,
  });

  res.json({ conversation: conv });
});

router.patch("/:id/status", requirePermission("conversations:resolve"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId, userId } = req.sessionUser;
  const newStatus = parsed.data.status;

  const [existing] = await db.select({
    id: conversationsTable.id,
    status: conversationsTable.status,
    contactId: conversationsTable.contactId,
    contactName: contactsTable.name,
  })
    .from(conversationsTable)
    .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  const currentStatus = existing.status as ConvStatus;
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];

  if (!allowed.includes(newStatus as ConvStatus)) {
    const isManagerOrOwner = req.sessionUser.permissions.includes("channels:manage");
    if (currentStatus === "closed" && newStatus === "open" && isManagerOrOwner) {
    } else {
      res.status(422).json({
        error: `لا يمكن تغيير الحالة من "${currentStatus}" إلى "${newStatus}"`,
        code: "INVALID_TRANSITION",
      });
      return;
    }
  }

  const now = new Date();
  const updates: Record<string, unknown> = { status: newStatus, updatedAt: now };
  if (newStatus === "resolved") updates.resolvedAt = now;
  if (newStatus === "closed") { updates.closedAt = now; updates.resolvedAt = now; }
  if (newStatus === "snoozed" && parsed.data.snoozedUntil) {
    updates.snoozedUntil = new Date(parsed.data.snoozedUntil);
  }

  const [conv] = await db.update(conversationsTable)
    .set(updates)
    .where(and(eq(conversationsTable.id, existing.id), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "conversation",
    entityId: conv.id,
    entityLabel: `محادثة ${existing.contactName ?? conv.id.slice(0, 8)}`,
    newData: { previousStatus: currentStatus, newStatus },
  });

  await addContactTimeline({
    workspaceId: activeWorkspaceId,
    contactId: existing.contactId,
    eventType: "conversation_status_changed",
    entityType: "conversation",
    entityId: conv.id,
    title: `تغيّرت حالة المحادثة إلى "${newStatus}"`,
    createdBy: userId,
  });

  res.json({ conversation: conv });
});

router.post("/:id/labels", requirePermission("conversations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = labelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId } = req.sessionUser;
  const label = parsed.data.label;

  const [existing] = await db.select({ id: conversationsTable.id, labels: conversationsTable.labels })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  if ((existing.labels ?? []).includes(label)) {
    res.json({ labels: existing.labels });
    return;
  }

  const [conv] = await db.update(conversationsTable)
    .set({ labels: sql`array_append(${conversationsTable.labels}, ${label})`, updatedAt: new Date() })
    .where(and(eq(conversationsTable.id, existing.id), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .returning({ labels: conversationsTable.labels });

  res.json({ labels: conv.labels });
});

router.delete("/:id/labels/:label", requirePermission("conversations:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const label = String(req.params.label);

  const [existing] = await db.select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  const [conv] = await db.update(conversationsTable)
    .set({ labels: sql`array_remove(${conversationsTable.labels}, ${label})`, updatedAt: new Date() })
    .where(and(eq(conversationsTable.id, existing.id), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .returning({ labels: conversationsTable.labels });

  res.json({ labels: conv.labels });
});

router.patch("/:id/assign", requirePermission("conversations:assign"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId, userId } = req.sessionUser;
  const { membershipId } = parsed.data;

  const [existing] = await db.select({
    id: conversationsTable.id,
    contactId: conversationsTable.contactId,
    contactName: contactsTable.name,
  })
    .from(conversationsTable)
    .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  let assigneeName: string | null = null;
  if (membershipId) {
    const [member] = await db.select({
      id: workspaceMembershipsTable.id,
      name: usersTable.name,
    })
      .from(workspaceMembershipsTable)
      .leftJoin(usersTable, eq(workspaceMembershipsTable.userId, usersTable.id))
      .where(and(
        eq(workspaceMembershipsTable.id, membershipId),
        eq(workspaceMembershipsTable.workspaceId, activeWorkspaceId)
      ))
      .limit(1);

    if (!member) { res.status(404).json({ error: "العضو غير موجود في هذا الفضاء" }); return; }
    assigneeName = member.name ?? null;
  }

  const [conv] = await db.update(conversationsTable)
    .set({ assignedMembershipId: membershipId, updatedAt: new Date() })
    .where(and(eq(conversationsTable.id, existing.id), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update",
    severity: "info",
    entityType: "conversation",
    entityId: conv.id,
    entityLabel: `محادثة ${existing.contactName ?? conv.id.slice(0, 8)}`,
    newData: { assignedMembershipId: membershipId, assigneeName },
  });

  await addContactTimeline({
    workspaceId: activeWorkspaceId,
    contactId: existing.contactId,
    eventType: "conversation_assigned",
    entityType: "conversation",
    entityId: conv.id,
    title: membershipId ? `تم تعيين المحادثة إلى ${assigneeName ?? "موظف"}` : "تم إلغاء تعيين المحادثة",
    createdBy: userId,
  });

  res.json({ conversation: conv, assigneeName });
});

// PD-11 fix: الصلاحية كانت conversations:manage وهي غير معرّفة في النظام إطلاقاً → لا يملكها أحد
// (ولا المالك) فالزر لا يظهر والمسار يُرفض. resolve صلاحية موجودة يملكها كل من يدير الوارد.
router.patch("/:id/agent-status", requirePermission("conversations:resolve"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = agentStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId, userId } = req.sessionUser;
  const [existing] = await db.select({
    id: conversationsTable.id,
    subject: conversationsTable.subject,
    agentStatus: conversationsTable.agentStatus,
    needsHuman: conversationsTable.needsHuman,
  })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  const now = new Date();
  const updates: Record<string, unknown> = {
    agentStatus: parsed.data.status,
    updatedAt: now,
  };

  if (parsed.data.status === "active") {
    updates.agentPausedUntil = null;
    updates.consecutiveAgentReplies = 0;
    updates.needsHuman = false;
    updates.escalationReason = null;
  } else if (parsed.data.status === "paused") {
    const pauseMinutes = parsed.data.pauseMinutes ?? 30;
    updates.agentPausedUntil = new Date(now.getTime() + pauseMinutes * 60_000);
  } else {
    updates.agentPausedUntil = null;
  }

  const [conversation] = await db.update(conversationsTable)
    .set(updates)
    .where(and(eq(conversationsTable.id, existing.id), eq(conversationsTable.workspaceId, activeWorkspaceId)))
    .returning();

  if (!conversation) { res.status(500).json({ error: "فشل تحديث حالة الوكيل" }); return; }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    workspaceId: activeWorkspaceId,
    action: "agent_status_change",
    entityType: "conversation",
    entityId: conversation.id,
    entityLabel: conversation.subject ?? conversation.id.slice(0, 8),
    newData: {
      previousAgentStatus: existing.agentStatus,
      agentStatus: parsed.data.status,
      pauseMinutes: parsed.data.pauseMinutes ?? null,
    },
  });

  if (parsed.data.status === "active" && (existing.agentStatus !== "active" || existing.needsHuman)) {
    // لا تُوقظ الوكيل إلا إذا كانت آخر رسالة من العميل (inbound) غير مُجابة. وإلا — حين تكون آخر
    // رسالة ردّاً من الموظف/الوكيل والعميل لم يكتب جديداً — تُرجِع الإعادة الوكيل للعمل بصمت
    // بلا ردّ تلقائي على رسالة قديمة (تصحيح: كان يردّ دائماً عند الإعادة).
    const [lastMsg] = await db.select({ direction: messagesTable.direction })
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conversation.id), eq(messagesTable.workspaceId, activeWorkspaceId)))
      .orderBy(desc(messagesTable.sentAt))
      .limit(1);
    if (lastMsg?.direction === "inbound") {
      await publishDomainEvent({
        eventType: "message.received",
        entityType: "conversation",
        entityId: conversation.id,
        payload: {
          conversationId: conversation.id,
          source: "agent_reactivated",
        },
        sessionUser: req.sessionUser,
      });
    }
  }

  res.json({ conversation });
});

router.get("/:id/messages", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
  const offset = (page - 1) * limit;

  const [conv] = await db.select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.id, req.params.id as string),
      eq(conversationsTable.workspaceId, activeWorkspaceId)
    ))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

  const [messages, [{ total }]] = await Promise.all([
    db.select().from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conv.id), eq(messagesTable.workspaceId, activeWorkspaceId)))
      .orderBy(asc(messagesTable.sentAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conv.id), eq(messagesTable.workspaceId, activeWorkspaceId))),
  ]);

  res.json({ messages, total: Number(total), page, limit });
});

function asAttachmentList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

// Only public https URLs may be proxied. Attachment URLs can be user-influenced
// (manual replies / imports), so private ranges, loopback, and the cloud metadata
// endpoint must never be reachable through the attachment proxy (SSRF).
function isSafePublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (host === "metadata.google.internal" || host === "169.254.169.254") return false;
  // IPv6 loopback/link-local/unique-local
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  // IPv4 literal in private/reserved ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  return true;
}

router.get("/:id/messages/:messageId/attachments/:index", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const attachmentIndex = Number.parseInt(String(req.params.index), 10);
  if (!Number.isFinite(attachmentIndex) || attachmentIndex < 0) {
    res.status(400).json({ error: "فهرس المرفق غير صحيح" });
    return;
  }

  const [row] = await db.select({
    messageId: messagesTable.id,
    attachments: messagesTable.attachments,
    conversationId: messagesTable.conversationId,
  })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.id, String(req.params.messageId)),
      eq(messagesTable.conversationId, String(req.params.id)),
      eq(messagesTable.workspaceId, activeWorkspaceId),
    ))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "الرسالة غير موجودة" });
    return;
  }

  const attachment = asAttachmentList(row.attachments)[attachmentIndex];
  if (!attachment) {
    res.status(404).json({ error: "المرفق غير موجود" });
    return;
  }

  const directUrl = typeof attachment.url === "string" ? attachment.url : null;
  if (directUrl) {
    // SSRF guard: attachment URLs can originate from manual replies, so never proxy
    // anything but public https hosts — block loopback/private ranges and the GCP
    // metadata server, and refuse redirects (a public URL could 302 to an internal IP).
    if (!isSafePublicHttpsUrl(directUrl)) {
      res.status(400).json({ error: "رابط المرفق غير مسموح" });
      return;
    }
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(directUrl, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    } catch {
      res.status(502).json({ error: "تعذّر جلب الوسائط" });
      return;
    }
    if (!response.ok || !response.body) {
      res.status(502).json({ error: "تعذّر جلب الوسائط" });
      return;
    }
    res.setHeader("Content-Type", response.headers.get("content-type") ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(() => { if (!res.headersSent) res.status(502).end(); });
    return;
  }

  const mediaId = typeof attachment.media_id === "string" ? attachment.media_id : null;
  if (!mediaId) {
    res.status(404).json({ error: "لا يوجد مرجع وسائط قابل للعرض" });
    return;
  }

  try {
    const stream = await fetchMetaMediaStream(mediaId);
    res.setHeader("Content-Type", stream.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    const reader = stream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    logger.warn({ err, messageId: row.messageId, mediaId }, "Failed to stream message attachment");
    res.status(502).json({ error: "تعذّر جلب الوسائط من ميتا" });
  }
});

router.post("/:id/messages", requirePermission("conversations:reply"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId, name } = req.sessionUser;

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  try {
    const [conv] = await db.select({
      id: conversationsTable.id,
      status: conversationsTable.status,
      contactId: conversationsTable.contactId,
      contactName: contactsTable.name,
      channelAccountId: conversationsTable.channelAccountId,
      externalThreadId: conversationsTable.externalThreadId,
      channel: conversationsTable.channel,
    })
      .from(conversationsTable)
      .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
      .where(and(
        eq(conversationsTable.id, req.params.id as string),
        eq(conversationsTable.workspaceId, activeWorkspaceId)
      ))
      .limit(1);

    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

    const { content, direction, isPrivateNote, contentType, source, mediaUrl, mediaType, inReplyTo } = parsed.data;

    let replyToMessageId: string | null = null;
    if (inReplyTo) {
      const [quoted] = await db.select({ id: messagesTable.id })
        .from(messagesTable)
        .where(and(eq(messagesTable.id, inReplyTo), eq(messagesTable.conversationId, conv.id), eq(messagesTable.workspaceId, activeWorkspaceId)))
        .limit(1);
      if (!quoted) { res.status(400).json({ error: "الرسالة المُقتبسة غير موجودة في هذه المحادثة" }); return; }
      replyToMessageId = quoted.id;
    }
    const effectiveDirection = isPrivateNote ? "internal" : direction;
    const effectiveSenderType = direction === "inbound" ? "contact" : "user";
    const trimmedContent = content.trim();
    const hasMedia = Boolean(mediaUrl && mediaType);
    const isOutboundToChannel = effectiveDirection === "outbound" && !isPrivateNote
      && !!conv.channelAccountId && !!conv.externalThreadId;
    const isWhatsAppOutbound = isOutboundToChannel && ["whatsapp_api", "whatsapp"].includes(conv.channel);
    let whatsappRecipient: Awaited<ReturnType<typeof resolveWhatsAppConversationRecipient>> | null = null;

    if (isWhatsAppOutbound && conv.channelAccountId) {
      whatsappRecipient = await resolveWhatsAppConversationRecipient({
        workspaceId: activeWorkspaceId,
        channelAccountId: conv.channelAccountId,
        contactId: conv.contactId,
        externalThreadId: conv.externalThreadId,
      });
      if (!whatsappRecipient.ok) {
        res.status(409).json({ error: whatsappRecipient.message, code: whatsappRecipient.code });
        return;
      }
    }

    if (hasMedia && isOutboundToChannel && !["whatsapp_api", "whatsapp", "instagram", "messenger"].includes(conv.channel)) {
      res.status(400).json({ error: "إرسال الوسائط من الوارد غير مدعوم لهذه القناة" });
      return;
    }

    const effectiveContent = trimmedContent || (hasMedia
      ? (mediaType === "image" ? "[صورة]" : mediaType === "audio" ? "[رسالة صوتية]" : mediaType === "video" ? "[فيديو]" : "[مستند]")
      : "");
    const messageAttachments = hasMedia
      ? [{ type: mediaType, provider: "manual", url: mediaUrl, caption: trimmedContent || null }]
      : [];

    const [message] = await db.insert(messagesTable).values({
      conversationId: conv.id,
      workspaceId: activeWorkspaceId,
      content: effectiveContent,
      direction: effectiveDirection,
      senderType: isPrivateNote ? "user" : effectiveSenderType,
      senderId: userId,
      senderName: name,
      source,
      contentType: hasMedia ? (mediaType === "audio" ? "audio" : mediaType === "document" ? "document" : "image") : contentType,
      attachments: messageAttachments,
      isPrivateNote,
      deliveryStatus: isOutboundToChannel ? "pending" : "sent",
      sentAt: new Date(),
      replyToMessageId,
    }).returning();

    // PD-1 fix: أضف outbox event للرسائل الخارجة اليدوية كي تصل للعميل عبر القناة الصحيحة
    if (isOutboundToChannel) {
      if (hasMedia) {
        const outboxEventType = conv.channel === "instagram"
          ? "message.send.instagram.media"
          : conv.channel === "messenger"
            ? "message.send.messenger.media"
            : "message.send.whatsapp.media";
        await db.insert(outboxEventsTable).values({
          workspaceId: activeWorkspaceId,
          eventType: outboxEventType,
          entityType: "conversation",
          entityId: conv.id,
          idempotencyKey: `manual-media:${userId}:${message.id}`,
          payload: {
            channelAccountId: conv.channelAccountId,
            conversationId: conv.id,
            to: whatsappRecipient?.ok ? whatsappRecipient.to : conv.externalThreadId,
            ...(whatsappRecipient?.ok ? { recipientIdentityType: whatsappRecipient.identityType } : {}),
            mediaType,
            mediaUrl,
            body: trimmedContent || undefined,
            caption: trimmedContent || undefined,
            manualReply: true,
            messageId: message.id,
          },
          status: "pending",
          nextAttemptAt: new Date(),
        }).onConflictDoNothing();
      } else {
      const outboxEventType = conv.channel === "instagram"
        ? "message.send.instagram.text"
        : conv.channel === "messenger"
          ? "message.send.messenger.text"
          : "message.send.whatsapp.text";
      await db.insert(outboxEventsTable).values({
        workspaceId: activeWorkspaceId,
        eventType: outboxEventType,
        entityType: "conversation",
        entityId: conv.id,
        idempotencyKey: `manual:${userId}:${message.id}`,
        payload: {
          channelAccountId: conv.channelAccountId,
          conversationId: conv.id,
          to: whatsappRecipient?.ok ? whatsappRecipient.to : conv.externalThreadId,
          ...(whatsappRecipient?.ok ? { recipientIdentityType: whatsappRecipient.identityType } : {}),
          body: effectiveContent,
          manualReply: true,
          messageId: message.id,
        },
        status: "pending",
        nextAttemptAt: new Date(),
      }).onConflictDoNothing();
      }
    }

    const convUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (!isPrivateNote) {
      convUpdates.lastMessage = effectiveContent.slice(0, 120);
      convUpdates.lastMessageAt = new Date();
      if (direction === "inbound") {
        convUpdates.unreadCount = sql`${conversationsTable.unreadCount} + 1`;
        convUpdates.consecutiveAgentReplies = 0;
      }
      if (conv.status === "new" && direction === "outbound") {
        convUpdates.status = "open";
      }
    }

    await db.update(conversationsTable)
      .set(convUpdates)
      .where(and(eq(conversationsTable.id, conv.id), eq(conversationsTable.workspaceId, activeWorkspaceId)));

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "message",
      entityId: message.id,
      entityLabel: `رسالة في محادثة ${conv.id.slice(0, 8)}`,
      newData: { direction: effectiveDirection, isPrivateNote, contentPreview: effectiveContent.slice(0, 80) },
    });

    if (!isPrivateNote) {
      await addContactTimeline({
        workspaceId: activeWorkspaceId,
        contactId: conv.contactId,
        eventType: "message_added",
        entityType: "message",
        entityId: message.id,
        title: direction === "inbound" ? "رسالة واردة من العميل" : "رسالة صادرة",
        description: effectiveContent.slice(0, 80),
        createdBy: userId,
      });

      if (effectiveDirection === "inbound") {
        await publishDomainEvent({
          eventType: "message.received",
          entityType: "message",
          entityId: message.id,
          payload: { conversationId: conv.id, contactId: conv.contactId, source, contentType },
          sessionUser: req.sessionUser,
        });
      } else {
        emitWorkspaceEvent({
          workspaceId: activeWorkspaceId,
          type: "message.new",
          entityType: "message",
          entityId: message.id,
          payload: { conversationId: conv.id, direction: effectiveDirection, source: "manual" },
        });
      }
    }

    res.status(201).json({ message });
  } catch (err) {
    logger.error({ err }, "Failed to send message");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.post("/:id/import", requirePermission("conversations:reply"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" });
    return;
  }

  const { activeWorkspaceId, userId, name } = req.sessionUser;

  try {
    const [conv] = await db.select({
      id: conversationsTable.id,
      status: conversationsTable.status,
      contactId: conversationsTable.contactId,
    })
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.id, req.params.id as string),
        eq(conversationsTable.workspaceId, activeWorkspaceId)
      ))
      .limit(1);

    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

    const { text } = parsed.data;
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
    const segments = paragraphs.length >= 2 ? paragraphs : [text.trim()];

    const now = new Date();
    const insertedMessages = [];
    for (let i = 0; i < segments.length; i++) {
      const [msg] = await db.insert(messagesTable).values({
        conversationId: conv.id,
        workspaceId: activeWorkspaceId,
        content: segments[i],
        direction: "inbound",
        senderType: "contact",
        senderId: userId,
        senderName: name,
        source: "paste",
        contentType: "text",
        deliveryStatus: "sent",
        sentAt: new Date(now.getTime() + i * 1000),
      }).returning();
      insertedMessages.push(msg);
    }

    await db.update(conversationsTable)
      .set({
        lastMessage: segments[segments.length - 1]?.slice(0, 120) ?? "",
        lastMessageAt: now,
        status: conv.status === "new" ? "open" : conv.status,
        updatedAt: now,
      })
      .where(and(eq(conversationsTable.id, conv.id), eq(conversationsTable.workspaceId, activeWorkspaceId)));

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "conversation",
      entityId: conv.id,
      entityLabel: `استيراد محادثة ${conv.id.slice(0, 8)}`,
      newData: { source: "paste", segments: segments.length },
    });

    await addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: conv.contactId,
      eventType: "conversation_imported",
      entityType: "conversation",
      entityId: conv.id,
      title: "تم استيراد محادثة بالنسخ واللصق",
      description: `${segments.length} رسالة`,
      createdBy: userId,
    });

    res.status(201).json({ messages: insertedMessages, count: insertedMessages.length });
  } catch (err) {
    logger.error({ err }, "Failed to import conversation");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

export default router;
