import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, asc, count, ilike, or, sql } from "drizzle-orm";
import {
  db, conversationsTable, messagesTable, contactsTable,
  contactChannelsTable, contactTimelineTable, workspaceMembershipsTable, usersTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

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
  content: z.string().min(1, "محتوى الرسالة مطلوب"),
  direction: z.enum(["outbound", "inbound", "internal"]).default("outbound"),
  isPrivateNote: z.boolean().default(false),
  contentType: z.enum(["text", "image", "audio", "document", "note"]).default("text"),
  source: z.enum(["manual", "paste", "widget", "api", "automation"]).default("manual"),
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

const importSchema = z.object({
  text: z.string().min(1, "نص المحادثة مطلوب").max(50000),
});

router.get("/", requirePermission("conversations:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = (req.query.status as string) || "";
  const search = (req.query.search as string) || "";
  const channel = (req.query.channel as string) || "";
  const assignee = (req.query.assignee as string) || "";
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(conversationsTable.workspaceId, activeWorkspaceId)];
  if (status) conditions.push(eq(conversationsTable.status, status));
  if (channel) conditions.push(eq(conversationsTable.channel, channel));
  if (assignee === "unassigned") {
    conditions.push(sql`${conversationsTable.assignedMembershipId} IS NULL`);
  } else if (assignee) {
    conditions.push(eq(conversationsTable.assignedMembershipId, assignee));
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
      channel: conversationsTable.channel,
      status: conversationsTable.status,
      priority: conversationsTable.priority,
      subject: conversationsTable.subject,
      lastMessage: conversationsTable.lastMessage,
      lastMessageAt: conversationsTable.lastMessageAt,
      unreadCount: conversationsTable.unreadCount,
      assignedMembershipId: conversationsTable.assignedMembershipId,
      createdAt: conversationsTable.createdAt,
      contactId: conversationsTable.contactId,
      contactName: contactsTable.name,
      contactPhone: contactsTable.phone,
      contactCompany: contactsTable.company,
    })
    .from(conversationsTable)
    .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
    .where(and(...conditions));

  const [rows, [{ total }], countRows] = await Promise.all([
    baseQuery
      .orderBy(desc(conversationsTable.lastMessageAt), desc(conversationsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() })
      .from(conversationsTable)
      .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
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
        .where(eq(conversationsTable.id, conversation.id));
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
    channel: conversationsTable.channel,
    status: conversationsTable.status,
    priority: conversationsTable.priority,
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

  const [messages, contactChannels, assignedMember] = await Promise.all([
    db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(asc(messagesTable.sentAt))
      .limit(100),
    conv.contactId ? db.select().from(contactChannelsTable)
      .where(eq(contactChannelsTable.contactId, conv.contactId))
      : Promise.resolve([] as (typeof contactChannelsTable.$inferSelect)[]),
    conv.assignedMembershipId ? db.select({
      id: workspaceMembershipsTable.id,
      userId: usersTable.id,
      name: usersTable.name,
    }).from(workspaceMembershipsTable)
      .leftJoin(usersTable, eq(workspaceMembershipsTable.userId, usersTable.id))
      .where(eq(workspaceMembershipsTable.id, conv.assignedMembershipId))
      .limit(1) : Promise.resolve([] as { id: string; userId: string | null; name: string | null }[]),
  ]);

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
    .where(eq(conversationsTable.id, existing.id))
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
    .where(eq(conversationsTable.id, existing.id))
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
    .where(eq(conversationsTable.id, existing.id))
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
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(asc(messagesTable.sentAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id)),
  ]);

  res.json({ messages, total: Number(total), page, limit });
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
    })
      .from(conversationsTable)
      .leftJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
      .where(and(
        eq(conversationsTable.id, req.params.id as string),
        eq(conversationsTable.workspaceId, activeWorkspaceId)
      ))
      .limit(1);

    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة" }); return; }

    const { content, direction, isPrivateNote, contentType, source } = parsed.data;
    const effectiveDirection = isPrivateNote ? "internal" : direction;
    const effectiveSenderType = direction === "inbound" ? "contact" : "user";

    const [message] = await db.insert(messagesTable).values({
      conversationId: conv.id,
      workspaceId: activeWorkspaceId,
      content,
      direction: effectiveDirection,
      senderType: isPrivateNote ? "user" : effectiveSenderType,
      senderId: userId,
      senderName: name,
      source,
      contentType,
      isPrivateNote,
      deliveryStatus: "sent",
      sentAt: new Date(),
    }).returning();

    const convUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (!isPrivateNote) {
      convUpdates.lastMessage = content.slice(0, 120);
      convUpdates.lastMessageAt = new Date();
      if (direction === "inbound") {
        convUpdates.unreadCount = sql`${conversationsTable.unreadCount} + 1`;
      }
      if (conv.status === "new" && direction === "outbound") {
        convUpdates.status = "open";
      }
    }

    await db.update(conversationsTable)
      .set(convUpdates)
      .where(eq(conversationsTable.id, conv.id));

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "message",
      entityId: message.id,
      entityLabel: `رسالة في محادثة ${conv.id.slice(0, 8)}`,
      newData: { direction: effectiveDirection, isPrivateNote, contentPreview: content.slice(0, 80) },
    });

    if (!isPrivateNote) {
      await addContactTimeline({
        workspaceId: activeWorkspaceId,
        contactId: conv.contactId,
        eventType: "message_added",
        entityType: "message",
        entityId: message.id,
        title: direction === "inbound" ? "رسالة واردة من العميل" : "رسالة صادرة",
        description: content.slice(0, 80),
        createdBy: userId,
      });
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
      .where(eq(conversationsTable.id, conv.id));

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
