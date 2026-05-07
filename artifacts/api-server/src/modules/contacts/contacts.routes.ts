import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, ilike, desc, count, or } from "drizzle-orm";
import {
  db,
  contactsTable,
  contactChannelsTable,
  contactNotesTable,
  contactTimelineTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();
router.use(requireSession);

const VALID_CHANNEL_TYPES = ["phone", "whatsapp", "telegram", "instagram", "email", "widget"] as const;

function normalizeIdentifier(channelType: string, raw: string): string {
  if (channelType === "phone" || channelType === "whatsapp") {
    const cleaned = raw.replace(/[^\d+]/g, "");
    if (cleaned.startsWith("+967")) return cleaned;
    if (cleaned.startsWith("00967")) return "+" + cleaned.slice(2);
    if (cleaned.startsWith("967") && cleaned.length >= 12) return "+" + cleaned;
    if (cleaned.startsWith("0") && cleaned.length === 10) return "+967" + cleaned.slice(1);
    if (cleaned.startsWith("7") && cleaned.length === 9) return "+967" + cleaned;
    return cleaned || raw.trim();
  }
  if (channelType === "email") return raw.toLowerCase().trim();
  return raw.trim().toLowerCase();
}

async function addTimeline(params: {
  workspaceId: string;
  contactId: string;
  eventType: string;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(contactTimelineTable).values({
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      eventType: params.eventType,
      title: params.title,
      description: params.description ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      createdBy: params.createdBy ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write contact timeline event");
  }
}

async function assertContactOwned(
  contactId: string,
  workspaceId: string,
  res: Response
): Promise<(typeof contactsTable.$inferSelect) | null> {
  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.id, contactId),
        eq(contactsTable.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "العميل غير موجود" });
    return null;
  }
  return contact;
}

const createSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب").max(200),
  phone: z.string().optional(),
  email: z.string().email("بريد إلكتروني غير صحيح").optional().or(z.literal("")),
  city: z.string().optional(),
  company: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

const updateSchema = createSchema.partial();

const channelCreateSchema = z.object({
  channelType: z.enum(VALID_CHANNEL_TYPES, { message: "نوع القناة غير مدعوم" }),
  identifier: z.string().min(1, "المعرّف مطلوب"),
  isPrimary: z.boolean().optional().default(false),
});

const channelUpdateSchema = z.object({
  isPrimary: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  optedIn: z.boolean().optional(),
});

const noteCreateSchema = z.object({
  body: z.string().min(1, "نص الملاحظة مطلوب").max(5000),
  isPrivate: z.boolean().optional().default(false),
});

const noteUpdateSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  isPrivate: z.boolean().optional(),
});

// ─── CONTACTS LIST ────────────────────────────────────────────────────────────

router.get(
  "/",
  requirePermission("contacts:read"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId } = req.sessionUser;
    const search = req.query.search as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    const where = search
      ? and(
          eq(contactsTable.workspaceId, activeWorkspaceId),
          or(
            ilike(contactsTable.name, `%${search}%`),
            ilike(contactsTable.phone, `%${search}%`),
            ilike(contactsTable.email, `%${search}%`),
            ilike(contactsTable.company, `%${search}%`)
          )
        )
      : eq(contactsTable.workspaceId, activeWorkspaceId);

    const [contacts, [{ total }]] = await Promise.all([
      db
        .select()
        .from(contactsTable)
        .where(where)
        .orderBy(desc(contactsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(contactsTable).where(where),
    ]);

    res.json({ contacts, total: Number(total), page });
  }
);

// ─── CREATE CONTACT ───────────────────────────────────────────────────────────

router.post(
  "/",
  requirePermission("contacts:create"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;

    const [contact] = await db
      .insert(contactsTable)
      .values({
        ...parsed.data,
        workspaceId: activeWorkspaceId,
        createdBy: userId,
      })
      .returning();

    await Promise.all([
      createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "create",
        severity: "info",
        entityType: "contact",
        entityId: contact.id,
        entityLabel: contact.name,
        newData: { name: contact.name, phone: contact.phone ?? null, email: contact.email ?? null, company: contact.company ?? null },
      }),
      addTimeline({
        workspaceId: activeWorkspaceId,
        contactId: contact.id,
        eventType: "contact_created",
        title: `تم إنشاء العميل "${contact.name}"`,
        entityType: "contact",
        entityId: contact.id,
        createdBy: userId,
      }),
    ]);

    res.status(201).json({ contact });
  }
);

// ─── GET CONTACT ──────────────────────────────────────────────────────────────

router.get(
  "/:id",
  requirePermission("contacts:read"),
  async (req: AuthenticatedRequest, res: Response) => {
    const contact = await assertContactOwned(
      req.params.id as string,
      req.sessionUser.activeWorkspaceId,
      res
    );
    if (!contact) return;
    res.json({ contact });
  }
);

// ─── UPDATE CONTACT ───────────────────────────────────────────────────────────

router.patch(
  "/:id",
  requirePermission("contacts:update"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;
    const contactId = req.params.id as string;

    const existing = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!existing) return;

    const [contact] = await db
      .update(contactsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(contactsTable.id, contactId),
          eq(contactsTable.workspaceId, activeWorkspaceId)
        )
      )
      .returning();

    await Promise.all([
      createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "update",
        severity: "info",
        entityType: "contact",
        entityId: contact.id,
        entityLabel: contact.name,
        oldData: { name: existing.name, phone: existing.phone, email: existing.email, company: existing.company },
        newData: parsed.data,
      }),
      addTimeline({
        workspaceId: activeWorkspaceId,
        contactId: contact.id,
        eventType: "contact_updated",
        title: `تم تعديل بيانات العميل`,
        entityType: "contact",
        entityId: contact.id,
        createdBy: userId,
      }),
    ]);

    res.json({ contact });
  }
);

// ─── DELETE CONTACT ───────────────────────────────────────────────────────────

router.delete(
  "/:id",
  requirePermission("contacts:delete"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId, userId } = req.sessionUser;
    const contactId = req.params.id as string;

    const existing = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!existing) return;

    await db
      .delete(contactsTable)
      .where(
        and(
          eq(contactsTable.id, contactId),
          eq(contactsTable.workspaceId, activeWorkspaceId)
        )
      );

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "delete",
      severity: "warning",
      entityType: "contact",
      entityId: contactId,
      entityLabel: existing.name,
    });

    res.json({ message: "تم حذف العميل بنجاح" });
  }
);

// ─── CHANNELS ─────────────────────────────────────────────────────────────────

router.get(
  "/:id/channels",
  requirePermission("contacts:read"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId } = req.sessionUser;
    const contactId = req.params.id as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const channels = await db
      .select()
      .from(contactChannelsTable)
      .where(
        and(
          eq(contactChannelsTable.contactId, contactId),
          eq(contactChannelsTable.workspaceId, activeWorkspaceId)
        )
      )
      .orderBy(desc(contactChannelsTable.isPrimary), contactChannelsTable.createdAt);

    res.json({ channels });
  }
);

router.post(
  "/:id/channels",
  requirePermission("contacts:manage_channels"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = channelCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;
    const contactId = req.params.id as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const norm = normalizeIdentifier(parsed.data.channelType, parsed.data.identifier);

    const [dup] = await db
      .select({ id: contactChannelsTable.id, contactId: contactChannelsTable.contactId })
      .from(contactChannelsTable)
      .where(
        and(
          eq(contactChannelsTable.workspaceId, activeWorkspaceId),
          eq(contactChannelsTable.channelType, parsed.data.channelType),
          eq(contactChannelsTable.normalizedIdentifier, norm)
        )
      )
      .limit(1);

    if (dup) {
      if (dup.contactId === contactId) {
        res.status(409).json({ error: "هذه القناة مضافة بالفعل لهذا العميل" });
      } else {
        res.status(409).json({ error: "هذه القناة مرتبطة بعميل آخر" });
      }
      return;
    }

    const [channel] = await db
      .insert(contactChannelsTable)
      .values({
        workspaceId: activeWorkspaceId,
        contactId,
        channelType: parsed.data.channelType,
        identifier: parsed.data.identifier.trim(),
        normalizedIdentifier: norm,
        isPrimary: parsed.data.isPrimary,
      })
      .returning();

    await Promise.all([
      createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "create",
        severity: "info",
        entityType: "contact_channel",
        entityId: channel.id,
        entityLabel: `${parsed.data.channelType}: ${parsed.data.identifier}`,
        newData: { contactId, channelType: parsed.data.channelType, identifier: parsed.data.identifier },
      }),
      addTimeline({
        workspaceId: activeWorkspaceId,
        contactId,
        eventType: "channel_added",
        title: `تمت إضافة قناة ${parsed.data.channelType}`,
        description: parsed.data.identifier,
        entityType: "contact_channel",
        entityId: channel.id,
        createdBy: userId,
      }),
    ]);

    res.status(201).json({ channel });
  }
);

router.patch(
  "/:id/channels/:channelId",
  requirePermission("contacts:manage_channels"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = channelUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId } = req.sessionUser;
    const contactId = req.params.id as string;
    const channelId = req.params.channelId as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const [existing] = await db
      .select()
      .from(contactChannelsTable)
      .where(
        and(
          eq(contactChannelsTable.id, channelId),
          eq(contactChannelsTable.contactId, contactId),
          eq(contactChannelsTable.workspaceId, activeWorkspaceId)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "القناة غير موجودة" });
      return;
    }

    const updateData: Partial<typeof contactChannelsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.isPrimary !== undefined) updateData.isPrimary = parsed.data.isPrimary;
    if (parsed.data.isVerified !== undefined) updateData.isVerified = parsed.data.isVerified;
    if (parsed.data.optedIn !== undefined) {
      updateData.optedIn = parsed.data.optedIn;
      if (!parsed.data.optedIn) updateData.optedOutAt = new Date();
    }

    const [channel] = await db
      .update(contactChannelsTable)
      .set(updateData)
      .where(
        and(
          eq(contactChannelsTable.id, channelId),
          eq(contactChannelsTable.workspaceId, activeWorkspaceId)
        )
      )
      .returning();

    res.json({ channel });
  }
);

router.delete(
  "/:id/channels/:channelId",
  requirePermission("contacts:manage_channels"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId } = req.sessionUser;
    const contactId = req.params.id as string;
    const channelId = req.params.channelId as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const [existing] = await db
      .select()
      .from(contactChannelsTable)
      .where(
        and(
          eq(contactChannelsTable.id, channelId),
          eq(contactChannelsTable.contactId, contactId),
          eq(contactChannelsTable.workspaceId, activeWorkspaceId)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "القناة غير موجودة" });
      return;
    }

    await db
      .delete(contactChannelsTable)
      .where(
        and(
          eq(contactChannelsTable.id, channelId),
          eq(contactChannelsTable.workspaceId, activeWorkspaceId)
        )
      );

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "delete",
      severity: "info",
      entityType: "contact_channel",
      entityId: channelId,
      entityLabel: `${existing.channelType}: ${existing.identifier}`,
    });

    res.json({ message: "تم حذف القناة بنجاح" });
  }
);

// ─── NOTES ────────────────────────────────────────────────────────────────────

router.get(
  "/:id/notes",
  requirePermission("contacts:read"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId } = req.sessionUser;
    const contactId = req.params.id as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const notes = await db
      .select()
      .from(contactNotesTable)
      .where(
        and(
          eq(contactNotesTable.contactId, contactId),
          eq(contactNotesTable.workspaceId, activeWorkspaceId)
        )
      )
      .orderBy(desc(contactNotesTable.createdAt));

    res.json({ notes });
  }
);

router.post(
  "/:id/notes",
  requirePermission("contacts:manage_notes"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = noteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;
    const contactId = req.params.id as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const [note] = await db
      .insert(contactNotesTable)
      .values({
        workspaceId: activeWorkspaceId,
        contactId,
        authorId: userId,
        body: parsed.data.body,
        isPrivate: parsed.data.isPrivate,
      })
      .returning();

    await Promise.all([
      createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "create",
        severity: "info",
        entityType: "contact_note",
        entityId: note.id,
        entityLabel: contact.name,
        newData: { contactId, isPrivate: note.isPrivate },
      }),
      addTimeline({
        workspaceId: activeWorkspaceId,
        contactId,
        eventType: "note_added",
        title: "تمت إضافة ملاحظة",
        description: parsed.data.isPrivate ? "ملاحظة خاصة" : undefined,
        entityType: "contact_note",
        entityId: note.id,
        createdBy: userId,
      }),
    ]);

    res.status(201).json({ note });
  }
);

router.patch(
  "/:id/notes/:noteId",
  requirePermission("contacts:manage_notes"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = noteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;
    const contactId = req.params.id as string;
    const noteId = req.params.noteId as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const [existing] = await db
      .select()
      .from(contactNotesTable)
      .where(
        and(
          eq(contactNotesTable.id, noteId),
          eq(contactNotesTable.contactId, contactId),
          eq(contactNotesTable.workspaceId, activeWorkspaceId)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "الملاحظة غير موجودة" });
      return;
    }

    if (existing.authorId !== userId && !req.sessionUser.roleSlugs.some(r => r === "owner" || r === "manager")) {
      res.status(403).json({ error: "لا يمكنك تعديل ملاحظات الآخرين", code: "FORBIDDEN" });
      return;
    }

    const [note] = await db
      .update(contactNotesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(contactNotesTable.id, noteId),
          eq(contactNotesTable.workspaceId, activeWorkspaceId)
        )
      )
      .returning();

    res.json({ note });
  }
);

router.delete(
  "/:id/notes/:noteId",
  requirePermission("contacts:manage_notes"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId, userId } = req.sessionUser;
    const contactId = req.params.id as string;
    const noteId = req.params.noteId as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const [existing] = await db
      .select()
      .from(contactNotesTable)
      .where(
        and(
          eq(contactNotesTable.id, noteId),
          eq(contactNotesTable.contactId, contactId),
          eq(contactNotesTable.workspaceId, activeWorkspaceId)
        )
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "الملاحظة غير موجودة" });
      return;
    }

    if (existing.authorId !== userId && !req.sessionUser.roleSlugs.some(r => r === "owner" || r === "manager")) {
      res.status(403).json({ error: "لا يمكنك حذف ملاحظات الآخرين", code: "FORBIDDEN" });
      return;
    }

    await db
      .delete(contactNotesTable)
      .where(
        and(
          eq(contactNotesTable.id, noteId),
          eq(contactNotesTable.workspaceId, activeWorkspaceId)
        )
      );

    res.json({ message: "تم حذف الملاحظة بنجاح" });
  }
);

// ─── TIMELINE ─────────────────────────────────────────────────────────────────

router.get(
  "/:id/timeline",
  requirePermission("contacts:read"),
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeWorkspaceId } = req.sessionUser;
    const contactId = req.params.id as string;

    const contact = await assertContactOwned(contactId, activeWorkspaceId, res);
    if (!contact) return;

    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const timeline = await db
      .select()
      .from(contactTimelineTable)
      .where(
        and(
          eq(contactTimelineTable.contactId, contactId),
          eq(contactTimelineTable.workspaceId, activeWorkspaceId)
        )
      )
      .orderBy(desc(contactTimelineTable.occurredAt))
      .limit(limit)
      .offset(offset);

    res.json({ timeline });
  }
);

export default router;
