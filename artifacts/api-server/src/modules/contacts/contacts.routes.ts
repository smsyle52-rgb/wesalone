import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, ilike, desc, count, or, sql, inArray } from "drizzle-orm";
import {
  db,
  contactsTable,
  contactChannelsTable,
  contactNotesTable,
  contactTimelineTable,
  conversationsTable,
  ticketsTable,
  tasksTable,
  followupsTable,
  opportunitiesTable,
  ordersTable,
  paymentsTable,
  debtsTable,
  collectionNotesTable,
  broadcastRecipientsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { publishDomainEvent } from "../../lib/events";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();
router.use(requireSession);

const VALID_CHANNEL_TYPES = ["phone", "whatsapp", "whatsapp_api", "telegram", "instagram", "messenger", "email", "widget"] as const;
const WHATSAPP_CHANNEL_TYPES = ["whatsapp", "whatsapp_api"] as const;
const PHONE_IDENTITY_CHANNEL_TYPES = ["phone", "whatsapp", "whatsapp_api"] as const;

function canonicalChannelType(channelType: string): string {
  return channelType === "whatsapp_api" ? "whatsapp" : channelType;
}

function normalizeIdentifier(channelType: string, raw: string): string {
  if (channelType === "phone" || WHATSAPP_CHANNEL_TYPES.includes(channelType as (typeof WHATSAPP_CHANNEL_TYPES)[number])) {
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

function contactIdentityChannels(contact: { phone?: string | null; email?: string | null }) {
  const channels: Array<{ channelType: "phone" | "email"; identifier: string; normalizedIdentifier: string }> = [];
  if (contact.phone?.trim()) {
    channels.push({
      channelType: "phone",
      identifier: contact.phone.trim(),
      normalizedIdentifier: normalizeIdentifier("phone", contact.phone),
    });
  }
  if (contact.email?.trim()) {
    channels.push({
      channelType: "email",
      identifier: contact.email.trim(),
      normalizedIdentifier: normalizeIdentifier("email", contact.email),
    });
  }
  return channels;
}

async function findDuplicateIdentityChannel(
  workspaceId: string,
  contact: { phone?: string | null; email?: string | null },
  excludeContactId?: string,
) {
  for (const identity of contactIdentityChannels(contact)) {
    const duplicateTypes = identity.channelType === "phone"
      ? [...PHONE_IDENTITY_CHANNEL_TYPES]
      : [identity.channelType];
    const [duplicate] = await db
      .select({ contactId: contactChannelsTable.contactId, channelType: contactChannelsTable.channelType, identifier: contactChannelsTable.identifier })
      .from(contactChannelsTable)
      .where(and(
        eq(contactChannelsTable.workspaceId, workspaceId),
        inArray(contactChannelsTable.channelType, duplicateTypes),
        eq(contactChannelsTable.normalizedIdentifier, identity.normalizedIdentifier),
      ))
      .limit(1);
    if (duplicate && duplicate.contactId !== excludeContactId) return duplicate;
  }
  return null;
}

async function ensureIdentityChannels(
  workspaceId: string,
  contactId: string,
  contact: { phone?: string | null; email?: string | null },
) {
  const identities = contactIdentityChannels(contact);
  const desiredByType = new Map(identities.map((identity) => [identity.channelType, identity]));
  const generatedChannels = await db
    .select()
    .from(contactChannelsTable)
    .where(and(
      eq(contactChannelsTable.workspaceId, workspaceId),
      eq(contactChannelsTable.contactId, contactId),
      inArray(contactChannelsTable.channelType, ["phone", "email"]),
      sql`${contactChannelsTable.providerData}->>'source' = 'contact_identity'`,
    ));

  for (const channel of generatedChannels) {
    const desired = desiredByType.get(channel.channelType as "phone" | "email");
    if (!desired) {
      await db
        .delete(contactChannelsTable)
        .where(and(
          eq(contactChannelsTable.workspaceId, workspaceId),
          eq(contactChannelsTable.id, channel.id),
        ));
      continue;
    }

    await db
      .update(contactChannelsTable)
      .set({
        identifier: desired.identifier,
        normalizedIdentifier: desired.normalizedIdentifier,
        updatedAt: new Date(),
      })
      .where(and(
        eq(contactChannelsTable.workspaceId, workspaceId),
        eq(contactChannelsTable.id, channel.id),
      ));
    desiredByType.delete(desired.channelType);
  }

  for (const identity of desiredByType.values()) {
    await db
      .insert(contactChannelsTable)
      .values({
        workspaceId,
        contactId,
        channelType: identity.channelType,
        identifier: identity.identifier,
        normalizedIdentifier: identity.normalizedIdentifier,
        isPrimary: identity.channelType === "phone",
        isVerified: false,
        optedIn: false,
        providerData: { source: "contact_identity" },
      })
      .onConflictDoNothing();
  }
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
  customFields: z.record(z.unknown()).optional().default({}),
  tags: z.array(z.string()).optional().default([]),
});

const updateSchema = createSchema.partial();

const mergeSchema = z.object({
  sourceContactId: z.string().uuid("معرف جهة الاتصال المدموجة غير صحيح"),
});

const importSchema = z.object({
  csv: z.string().min(1, "ملف الاستيراد فارغ").max(1_000_000, "ملف الاستيراد أكبر من الحد المسموح"),
});

const IMPORT_HEADERS: Record<string, keyof z.infer<typeof createSchema>> = {
  name: "name", "الاسم": "name",
  phone: "phone", "الهاتف": "phone",
  email: "email", "البريد": "email", "البريد الإلكتروني": "email",
  city: "city", "المدينة": "city",
  company: "company", "الشركة": "company",
  tags: "tags", "الوسوم": "tags",
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("اقتباس غير مغلق في ملف CSV");
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

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
    const includeArchived = req.query.includeArchived === "true";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    const baseConditions = [eq(contactsTable.workspaceId, activeWorkspaceId)];
    if (!includeArchived) baseConditions.push(sql`${contactsTable.archivedAt} IS NULL`);

    const where = search
      ? and(
          ...baseConditions,
          or(
            ilike(contactsTable.name, `%${search}%`),
            ilike(contactsTable.phone, `%${search}%`),
            ilike(contactsTable.email, `%${search}%`),
            ilike(contactsTable.company, `%${search}%`)
          )
        )
      : and(...baseConditions);

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

router.get(
  "/export.csv",
  requirePermission("contacts:export"),
  async (req: AuthenticatedRequest, res: Response) => {
    const contacts = await db.select({
      name: contactsTable.name,
      phone: contactsTable.phone,
      email: contactsTable.email,
      city: contactsTable.city,
      company: contactsTable.company,
      tags: contactsTable.tags,
    }).from(contactsTable).where(and(
      eq(contactsTable.workspaceId, req.sessionUser.activeWorkspaceId),
      sql`${contactsTable.archivedAt} IS NULL`,
    )).orderBy(desc(contactsTable.createdAt));

    const lines = [
      ["name", "phone", "email", "city", "company", "tags"].map(csvCell).join(","),
      ...contacts.map((contact) => [
        contact.name, contact.phone, contact.email, contact.city, contact.company, (contact.tags ?? []).join("|"),
      ].map(csvCell).join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${lines.join("\r\n")}`);
  },
);

router.post(
  "/import",
  requirePermission("contacts:create"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsedBody = importSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.issues[0]?.message });
      return;
    }

    let rows: string[][];
    try {
      rows = parseCsv(parsedBody.data.csv.replace(/^\uFEFF/, ""));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "ملف CSV غير صالح" });
      return;
    }
    if (rows.length < 2) {
      res.status(400).json({ error: "يجب أن يحتوي الملف على عناوين وصف واحد على الأقل" });
      return;
    }
    if (rows.length > 1001) {
      res.status(400).json({ error: "الحد الأقصى للاستيراد هو 1000 جهة اتصال في المرة" });
      return;
    }

    const headers = rows[0].map((header) => IMPORT_HEADERS[header.trim().toLowerCase()] ?? null);
    if (!headers.includes("name")) {
      res.status(400).json({ error: "عمود الاسم مطلوب (name أو الاسم)" });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;
    const errors: Array<{ row: number; error: string }> = [];
    let imported = 0;
    let duplicates = 0;

    for (let index = 1; index < rows.length; index += 1) {
      const candidate: Record<string, unknown> = { tags: [] };
      headers.forEach((header, column) => {
        if (!header) return;
        const value = rows[index][column]?.trim() ?? "";
        candidate[header] = header === "tags"
          ? value.split("|").map((tag) => tag.trim()).filter(Boolean)
          : value;
      });
      const parsedContact = createSchema.safeParse(candidate);
      if (!parsedContact.success) {
        errors.push({ row: index + 1, error: parsedContact.error.issues[0]?.message ?? "بيانات غير صحيحة" });
        continue;
      }
      const duplicate = await findDuplicateIdentityChannel(activeWorkspaceId, parsedContact.data);
      if (duplicate) {
        duplicates += 1;
        continue;
      }
      const [contact] = await db.insert(contactsTable).values({
        ...parsedContact.data,
        workspaceId: activeWorkspaceId,
        createdBy: userId,
      }).returning();
      await ensureIdentityChannels(activeWorkspaceId, contact.id, contact);
      imported += 1;
    }

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "create",
      severity: "info",
      entityType: "contact_import",
      entityLabel: `استيراد ${imported} جهة اتصال`,
      newData: { imported, duplicates, invalid: errors.length, totalRows: rows.length - 1 },
    });
    res.json({ imported, duplicates, invalid: errors.length, errors: errors.slice(0, 50) });
  },
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

    const duplicateIdentity = await findDuplicateIdentityChannel(activeWorkspaceId, parsed.data);
    if (duplicateIdentity) {
      res.status(409).json({
        error: "رقم الهاتف أو البريد مرتبط بجهة اتصال أخرى",
        code: "CONTACT_IDENTITY_DUPLICATE",
        contactId: duplicateIdentity.contactId,
      });
      return;
    }

    const [contact] = await db
      .insert(contactsTable)
      .values({
        ...parsed.data,
        workspaceId: activeWorkspaceId,
        createdBy: userId,
      })
      .returning();

    await ensureIdentityChannels(activeWorkspaceId, contact.id, contact);

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

    const nextIdentity = {
      phone: parsed.data.phone ?? existing.phone,
      email: parsed.data.email ?? existing.email,
    };
    const duplicateIdentity = await findDuplicateIdentityChannel(activeWorkspaceId, nextIdentity, contactId);
    if (duplicateIdentity) {
      res.status(409).json({
        error: "رقم الهاتف أو البريد مرتبط بجهة اتصال أخرى",
        code: "CONTACT_IDENTITY_DUPLICATE",
        contactId: duplicateIdentity.contactId,
      });
      return;
    }

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

    await ensureIdentityChannels(activeWorkspaceId, contact.id, contact);

    if (parsed.data.tags) {
      const previousTags = new Set(existing.tags ?? []);
      const addedTags = parsed.data.tags.filter((tag) => !previousTags.has(tag));
      for (const tag of addedTags) {
        await publishDomainEvent({
          eventType: "contact.tag.added",
          entityType: "contact",
          entityId: contact.id,
          payload: { tag, contactId: contact.id },
          sessionUser: req.sessionUser,
        });
      }
    }

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

    const [contact] = await db
      .update(contactsTable)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(contactsTable.id, contactId),
          eq(contactsTable.workspaceId, activeWorkspaceId)
        )
      )
      .returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "warning",
      entityType: "contact",
      entityId: contactId,
      entityLabel: existing.name,
      oldData: { archivedAt: existing.archivedAt },
      newData: { operation: "archive", archivedAt: contact.archivedAt },
    });

    await addTimeline({
      workspaceId: activeWorkspaceId,
      contactId,
      eventType: "contact_archived",
      title: "تمت أرشفة جهة الاتصال",
      entityType: "contact",
      entityId: contactId,
      createdBy: userId,
    });

    res.json({ message: "تمت أرشفة جهة الاتصال بنجاح", contact });
  }
);

router.post(
  "/:id/merge",
  requirePermission("contacts:update"),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }

    const { activeWorkspaceId, userId } = req.sessionUser;
    const targetContactId = req.params.id as string;
    const sourceContactId = parsed.data.sourceContactId;

    if (targetContactId === sourceContactId) {
      res.status(400).json({ error: "لا يمكن دمج جهة الاتصال في نفسها", code: "SAME_CONTACT" });
      return;
    }

    const [target, source] = await Promise.all([
      assertContactOwned(targetContactId, activeWorkspaceId, res),
      assertContactOwned(sourceContactId, activeWorkspaceId, res),
    ]);
    if (!target || !source) return;

    const now = new Date();
    await db.transaction(async (tx) => {
      const targetChannels = await tx
        .select()
        .from(contactChannelsTable)
        .where(and(eq(contactChannelsTable.workspaceId, activeWorkspaceId), eq(contactChannelsTable.contactId, targetContactId)));
      const sourceChannels = await tx
        .select()
        .from(contactChannelsTable)
        .where(and(eq(contactChannelsTable.workspaceId, activeWorkspaceId), eq(contactChannelsTable.contactId, sourceContactId)));

      const targetChannelByIdentity = new Map(
        targetChannels.map((channel) => [`${canonicalChannelType(channel.channelType)}:${channel.normalizedIdentifier}`, channel.id]),
      );

      for (const sourceChannel of sourceChannels) {
        const identity = `${canonicalChannelType(sourceChannel.channelType)}:${sourceChannel.normalizedIdentifier}`;
        const targetChannelId = targetChannelByIdentity.get(identity);
        if (targetChannelId) {
          await tx.update(conversationsTable)
            .set({ contactChannelId: targetChannelId, updatedAt: now })
            .where(and(eq(conversationsTable.workspaceId, activeWorkspaceId), eq(conversationsTable.contactChannelId, sourceChannel.id)));
          await tx.update(broadcastRecipientsTable)
            .set({ contactChannelId: targetChannelId })
            .where(and(eq(broadcastRecipientsTable.workspaceId, activeWorkspaceId), eq(broadcastRecipientsTable.contactChannelId, sourceChannel.id)));
          await tx.delete(contactChannelsTable)
            .where(and(eq(contactChannelsTable.workspaceId, activeWorkspaceId), eq(contactChannelsTable.id, sourceChannel.id)));
        } else {
          await tx.update(contactChannelsTable)
            .set({ contactId: targetContactId, updatedAt: now })
            .where(and(eq(contactChannelsTable.workspaceId, activeWorkspaceId), eq(contactChannelsTable.id, sourceChannel.id)));
          targetChannelByIdentity.set(identity, sourceChannel.id);
        }
      }

      await Promise.all([
        tx.update(conversationsTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(conversationsTable.workspaceId, activeWorkspaceId), eq(conversationsTable.contactId, sourceContactId))),
        tx.update(ticketsTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(ticketsTable.workspaceId, activeWorkspaceId), eq(ticketsTable.contactId, sourceContactId))),
        tx.update(tasksTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(tasksTable.workspaceId, activeWorkspaceId), eq(tasksTable.contactId, sourceContactId))),
        tx.update(followupsTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(followupsTable.workspaceId, activeWorkspaceId), eq(followupsTable.contactId, sourceContactId))),
        tx.update(opportunitiesTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(opportunitiesTable.workspaceId, activeWorkspaceId), eq(opportunitiesTable.contactId, sourceContactId))),
        tx.update(ordersTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(ordersTable.workspaceId, activeWorkspaceId), eq(ordersTable.contactId, sourceContactId))),
        tx.update(paymentsTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(paymentsTable.workspaceId, activeWorkspaceId), eq(paymentsTable.contactId, sourceContactId))),
        tx.update(debtsTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(debtsTable.workspaceId, activeWorkspaceId), eq(debtsTable.contactId, sourceContactId))),
        tx.update(collectionNotesTable).set({ contactId: targetContactId })
          .where(and(eq(collectionNotesTable.workspaceId, activeWorkspaceId), eq(collectionNotesTable.contactId, sourceContactId))),
        tx.update(broadcastRecipientsTable).set({ contactId: targetContactId })
          .where(and(eq(broadcastRecipientsTable.workspaceId, activeWorkspaceId), eq(broadcastRecipientsTable.contactId, sourceContactId))),
        tx.update(contactNotesTable).set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(contactNotesTable.workspaceId, activeWorkspaceId), eq(contactNotesTable.contactId, sourceContactId))),
        tx.update(contactTimelineTable).set({ contactId: targetContactId })
          .where(and(eq(contactTimelineTable.workspaceId, activeWorkspaceId), eq(contactTimelineTable.contactId, sourceContactId))),
      ]);

      const mergedTags = Array.from(new Set([...(target.tags ?? []), ...(source.tags ?? [])]));
      const mergedCustomFields = {
        ...((source.customFields as Record<string, unknown> | null) ?? {}),
        ...((target.customFields as Record<string, unknown> | null) ?? {}),
      };

      await tx.update(contactsTable)
        .set({
          tags: mergedTags,
          customFields: mergedCustomFields,
          updatedAt: now,
        })
        .where(and(eq(contactsTable.workspaceId, activeWorkspaceId), eq(contactsTable.id, targetContactId)));

      await tx.update(contactsTable)
        .set({
          archivedAt: now,
          updatedAt: now,
        })
        .where(and(eq(contactsTable.workspaceId, activeWorkspaceId), eq(contactsTable.id, sourceContactId)));

      await tx.insert(contactTimelineTable).values({
        workspaceId: activeWorkspaceId,
        contactId: targetContactId,
        eventType: "contact_merged",
        title: "تم دمج جهة اتصال مكررة",
        description: source.name,
        entityType: "contact",
        entityId: sourceContactId,
        createdBy: userId,
        metadata: { sourceContactId, sourceName: source.name },
      });
    });

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "update",
      severity: "warning",
      entityType: "contact",
      entityId: targetContactId,
      entityLabel: target.name,
      oldData: { sourceContactId, sourceName: source.name },
      newData: { operation: "merge", targetContactId, targetName: target.name },
    });

    res.json({ success: true, targetContactId, archivedSourceContactId: sourceContactId });
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

    const channelType = canonicalChannelType(parsed.data.channelType);
    const norm = normalizeIdentifier(channelType, parsed.data.identifier);
    const duplicateTypes = channelType === "whatsapp" || channelType === "phone"
      ? [...PHONE_IDENTITY_CHANNEL_TYPES]
      : [channelType];

    const [dup] = await db
      .select({ id: contactChannelsTable.id, contactId: contactChannelsTable.contactId })
      .from(contactChannelsTable)
      .where(
        and(
          eq(contactChannelsTable.workspaceId, activeWorkspaceId),
          inArray(contactChannelsTable.channelType, duplicateTypes),
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
        channelType,
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
        entityLabel: `${channelType}: ${parsed.data.identifier}`,
        newData: { contactId, channelType, identifier: parsed.data.identifier },
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
