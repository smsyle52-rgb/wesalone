import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  broadcastRecipientsTable,
  broadcastsTable,
  channelAccountsTable,
  contactsTable,
  db,
  outboxEventsTable,
  whatsappTemplatesTable,
} from "@workspace/db";
import { errors } from "../../lib/errors";
import type { createBroadcastSchema, updateBroadcastSchema } from "./broadcasts.schema";
import type { z } from "zod";

type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;
type UpdateBroadcastInput = z.infer<typeof updateBroadcastSchema>;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeAudienceFilter(filter: Record<string, unknown>) {
  return {
    includeTags: [...asStringArray(filter.tags), ...asStringArray(filter.includeTags)],
    contactIds: [...asStringArray(filter.contact_ids), ...asStringArray(filter.contactIds)],
    excludeIds: [...asStringArray(filter.exclude_ids), ...asStringArray(filter.excludeIds)],
  };
}

function phoneLast4(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4) || null;
}

export async function assertBroadcastInputs(workspaceId: string, templateId: string, channelAccountId: string) {
  const [template] = await db
    .select({ id: whatsappTemplatesTable.id, status: whatsappTemplatesTable.status, name: whatsappTemplatesTable.name })
    .from(whatsappTemplatesTable)
    .where(and(eq(whatsappTemplatesTable.id, templateId), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
    .limit(1);
  if (!template) throw errors.notFound("القالب");

  const [channelAccount] = await db
    .select({ id: channelAccountsTable.id })
    .from(channelAccountsTable)
    .where(and(eq(channelAccountsTable.id, channelAccountId), eq(channelAccountsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!channelAccount) throw errors.notFound("حساب القناة");

  return { template, channelAccount };
}

export async function listBroadcasts(workspaceId: string, filters: { status?: string }) {
  const conditions = [eq(broadcastsTable.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(broadcastsTable.status, filters.status));

  const [broadcasts, [{ total }]] = await Promise.all([
    db
      .select({
        id: broadcastsTable.id,
        name: broadcastsTable.name,
        templateId: broadcastsTable.templateId,
        templateName: whatsappTemplatesTable.name,
        channelAccountId: broadcastsTable.channelAccountId,
        status: broadcastsTable.status,
        scheduledAt: broadcastsTable.scheduledAt,
        startedAt: broadcastsTable.startedAt,
        completedAt: broadcastsTable.completedAt,
        stats: broadcastsTable.stats,
        createdAt: broadcastsTable.createdAt,
        updatedAt: broadcastsTable.updatedAt,
      })
      .from(broadcastsTable)
      .leftJoin(whatsappTemplatesTable, eq(broadcastsTable.templateId, whatsappTemplatesTable.id))
      .where(and(...conditions))
      .orderBy(desc(broadcastsTable.updatedAt)),
    db.select({ total: count() }).from(broadcastsTable).where(and(...conditions)),
  ]);

  return { broadcasts, total: Number(total) };
}

export async function getBroadcast(workspaceId: string, id: string) {
  const [broadcast] = await db
    .select()
    .from(broadcastsTable)
    .where(and(eq(broadcastsTable.id, id), eq(broadcastsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!broadcast) throw errors.notFound("الحملة");
  const audience = await resolveAudience(workspaceId, broadcast.audienceFilter as Record<string, unknown>);
  return { broadcast, audienceCount: audience.length };
}

export async function createBroadcast(workspaceId: string, userId: string, input: CreateBroadcastInput) {
  await assertBroadcastInputs(workspaceId, input.templateId, input.channelAccountId);
  const [broadcast] = await db
    .insert(broadcastsTable)
    .values({
      workspaceId,
      name: input.name,
      templateId: input.templateId,
      channelAccountId: input.channelAccountId,
      audienceFilter: input.audienceFilter,
      variableMapping: input.variableMapping,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      createdBy: userId,
    })
    .returning();
  return broadcast;
}

export async function updateBroadcast(workspaceId: string, id: string, input: UpdateBroadcastInput) {
  const { broadcast: existing } = await getBroadcast(workspaceId, id);
  if (existing.status !== "draft") throw errors.businessViolation("يمكن تعديل الحملات وهي مسودة فقط");
  if (input.templateId || input.channelAccountId) {
    await assertBroadcastInputs(workspaceId, input.templateId ?? existing.templateId, input.channelAccountId ?? existing.channelAccountId);
  }

  const [broadcast] = await db
    .update(broadcastsTable)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.templateId !== undefined && { templateId: input.templateId }),
      ...(input.channelAccountId !== undefined && { channelAccountId: input.channelAccountId }),
      ...(input.audienceFilter !== undefined && { audienceFilter: input.audienceFilter }),
      ...(input.variableMapping !== undefined && { variableMapping: input.variableMapping }),
      ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(broadcastsTable.id, id), eq(broadcastsTable.workspaceId, workspaceId)))
    .returning();
  return broadcast;
}

export async function resolveAudience(workspaceId: string, filter: Record<string, unknown>) {
  const normalized = normalizeAudienceFilter(filter ?? {});
  const conditions = [eq(contactsTable.workspaceId, workspaceId)];
  if (normalized.contactIds.length > 0) conditions.push(inArray(contactsTable.id, normalized.contactIds));

  const contacts = await db
    .select({
      id: contactsTable.id,
      name: contactsTable.name,
      phone: contactsTable.phone,
      tags: contactsTable.tags,
    })
    .from(contactsTable)
    .where(and(...conditions))
    .limit(5000);

  const excluded = new Set(normalized.excludeIds);
  return contacts.filter((contact) => {
    if (excluded.has(contact.id)) return false;
    if (normalized.includeTags.length === 0) return true;
    return normalized.includeTags.some((tag) => contact.tags.includes(tag));
  });
}

export async function previewBroadcast(workspaceId: string, id: string) {
  const { broadcast } = await getBroadcast(workspaceId, id);
  const audience = await resolveAudience(workspaceId, broadcast.audienceFilter as Record<string, unknown>);
  return {
    count: audience.length,
    samples: audience.slice(0, 5).map((contact) => ({
      id: contact.id,
      name: contact.name,
      phoneLast4: phoneLast4(contact.phone),
    })),
  };
}

function templateComponentsFor(
  variableMapping: Record<string, string>,
  contact: { name: string | null; phone: string | null },
): Array<Record<string, unknown>> {
  const positions = Object.keys(variableMapping)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));
  if (positions.length === 0) return [];

  return [{
    type: "body",
    parameters: positions.map((position) => ({
      type: "text",
      text: variableMapping[position] === "phone" ? (contact.phone ?? "") : (contact.name ?? ""),
    })),
  }];
}

export async function startBroadcast(workspaceId: string, id: string) {
  const { broadcast } = await getBroadcast(workspaceId, id);
  if (!["draft", "scheduled"].includes(broadcast.status)) {
    throw errors.businessViolation("لا يمكن بدء حملة بدأت مسبقاً");
  }

  const [template] = await db
    .select({ status: whatsappTemplatesTable.status, name: whatsappTemplatesTable.name, language: whatsappTemplatesTable.language })
    .from(whatsappTemplatesTable)
    .where(and(eq(whatsappTemplatesTable.id, broadcast.templateId), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
    .limit(1);
  if (!template || template.status !== "approved") {
    throw errors.businessViolation("يجب اختيار قالب معتمد قبل بدء الحملة");
  }

  const audience = await resolveAudience(workspaceId, broadcast.audienceFilter as Record<string, unknown>);
  const now = new Date();
  const scheduledAt = broadcast.scheduledAt && broadcast.scheduledAt > now ? broadcast.scheduledAt : null;
  const status = scheduledAt ? "scheduled" : "sending";
  const variableMapping = (broadcast.variableMapping ?? {}) as Record<string, string>;

  await db.transaction(async (tx) => {
    await tx
      .update(broadcastsTable)
      .set({
        status,
        startedAt: status === "sending" ? now : null,
        stats: { total: audience.length, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
        updatedAt: now,
      })
      .where(and(eq(broadcastsTable.id, id), eq(broadcastsTable.workspaceId, workspaceId)));

    for (let i = 0; i < audience.length; i += 500) {
      const chunk = audience.slice(i, i + 500);
      const recipients = await tx
        .insert(broadcastRecipientsTable)
        .values(chunk.map((contact) => ({
          broadcastId: id,
          workspaceId,
          contactId: contact.id,
          contactChannelId: null,
          status: contact.phone ? "queued" : "failed",
          errorMessage: contact.phone ? null : "لا يوجد رقم هاتف لهذا العميل",
        })))
        .onConflictDoNothing()
        .returning({
          id: broadcastRecipientsTable.id,
          contactId: broadcastRecipientsTable.contactId,
        });

      const contactById = new Map(chunk.map((contact) => [contact.id, contact]));
      const sendable = recipients.filter((recipient) => contactById.get(recipient.contactId)?.phone);

      if (sendable.length > 0) {
        await tx.insert(outboxEventsTable).values(sendable.map((recipient) => {
          const contact = contactById.get(recipient.contactId)!;
          return {
            workspaceId,
            eventType: "message.send.whatsapp.template",
            entityType: "broadcast_recipient",
            entityId: recipient.id,
            idempotencyKey: `${id}:${recipient.contactId}`,
            nextAttemptAt: scheduledAt,
            payload: {
              broadcastId: id,
              channelAccountId: broadcast.channelAccountId,
              to: contact.phone,
              templateName: template.name,
              language: template.language,
              components: templateComponentsFor(variableMapping, contact),
              contactId: recipient.contactId,
            },
          };
        })).onConflictDoNothing();
      }
    }
  });

  return getBroadcast(workspaceId, id);
}

export async function cancelBroadcast(workspaceId: string, id: string) {
  const { broadcast } = await getBroadcast(workspaceId, id);
  if (!["draft", "scheduled", "sending"].includes(broadcast.status)) {
    throw errors.businessViolation("لا يمكن إلغاء هذه الحملة");
  }

  const recipients = await db
    .select({ id: broadcastRecipientsTable.id })
    .from(broadcastRecipientsTable)
    .where(and(eq(broadcastRecipientsTable.workspaceId, workspaceId), eq(broadcastRecipientsTable.broadcastId, id)));

  await db.transaction(async (tx) => {
    await tx
      .update(broadcastsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(broadcastsTable.id, id), eq(broadcastsTable.workspaceId, workspaceId)));

    if (recipients.length > 0) {
      await tx
        .update(outboxEventsTable)
        .set({ status: "cancelled" })
        .where(and(
          eq(outboxEventsTable.entityType, "broadcast_recipient"),
          inArray(outboxEventsTable.entityId, recipients.map((recipient) => recipient.id)),
        ));
    }
  });

  return getBroadcast(workspaceId, id);
}

export async function listRecipients(workspaceId: string, id: string, status?: string) {
  const conditions = [eq(broadcastRecipientsTable.workspaceId, workspaceId), eq(broadcastRecipientsTable.broadcastId, id)];
  if (status) conditions.push(eq(broadcastRecipientsTable.status, status));
  const [recipients, [{ total }]] = await Promise.all([
    db
      .select({
        id: broadcastRecipientsTable.id,
        status: broadcastRecipientsTable.status,
        contactId: broadcastRecipientsTable.contactId,
        contactName: contactsTable.name,
        phone: contactsTable.phone,
        sentAt: broadcastRecipientsTable.sentAt,
        deliveredAt: broadcastRecipientsTable.deliveredAt,
        readAt: broadcastRecipientsTable.readAt,
        repliedAt: broadcastRecipientsTable.repliedAt,
        errorMessage: broadcastRecipientsTable.errorMessage,
      })
      .from(broadcastRecipientsTable)
      .leftJoin(contactsTable, eq(broadcastRecipientsTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(broadcastRecipientsTable.id))
      .limit(100),
    db.select({ total: count() }).from(broadcastRecipientsTable).where(and(...conditions)),
  ]);
  return { recipients, total: Number(total) };
}

export async function getBroadcastStats(workspaceId: string, id: string) {
  const rows = await db
    .select({ status: broadcastRecipientsTable.status, total: count() })
    .from(broadcastRecipientsTable)
    .where(and(eq(broadcastRecipientsTable.workspaceId, workspaceId), eq(broadcastRecipientsTable.broadcastId, id)))
    .groupBy(broadcastRecipientsTable.status);

  const stats = { queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in stats) stats[row.status as keyof typeof stats] = Number(row.total);
  }
  return { stats };
}
