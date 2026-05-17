import { and, count, desc, eq } from "drizzle-orm";
import { channelAccountsTable, db, templateVersionsTable, whatsappTemplatesTable } from "@workspace/db";
import { errors } from "../../lib/errors";
import { fetchTemplateStatus, submitTemplate as submitMetaTemplate } from "../../services/meta-graph";
import type { createTemplateSchema, updateTemplateSchema } from "./templates.schema";
import type { z } from "zod";

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export async function listTemplates(
  workspaceId: string,
  filters: { status?: string; language?: string; category?: string },
) {
  const conditions = [eq(whatsappTemplatesTable.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(whatsappTemplatesTable.status, filters.status));
  if (filters.language) conditions.push(eq(whatsappTemplatesTable.language, filters.language));
  if (filters.category) conditions.push(eq(whatsappTemplatesTable.category, filters.category));

  const [templates, [{ total }]] = await Promise.all([
    db
      .select()
      .from(whatsappTemplatesTable)
      .where(and(...conditions))
      .orderBy(desc(whatsappTemplatesTable.updatedAt)),
    db.select({ total: count() }).from(whatsappTemplatesTable).where(and(...conditions)),
  ]);

  return { templates, total: Number(total) };
}

export async function getTemplate(workspaceId: string, id: string) {
  const [template] = await db
    .select()
    .from(whatsappTemplatesTable)
    .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
    .limit(1);

  if (!template) throw errors.notFound("القالب");

  const versions = await db
    .select()
    .from(templateVersionsTable)
    .where(and(eq(templateVersionsTable.templateId, id), eq(templateVersionsTable.workspaceId, workspaceId)))
    .orderBy(desc(templateVersionsTable.versionNumber));

  return { template, versions };
}

export async function createTemplate(workspaceId: string, userId: string, input: CreateTemplateInput) {
  const [template] = await db
    .insert(whatsappTemplatesTable)
    .values({
      workspaceId,
      name: input.name,
      language: input.language,
      category: input.category,
      channelAccountId: input.channelAccountId ?? null,
      components: input.components,
      variables: input.variables,
      createdBy: userId,
    })
    .returning();

  return template;
}

export async function updateTemplate(workspaceId: string, id: string, input: UpdateTemplateInput) {
  const { template: existing } = await getTemplate(workspaceId, id);
  if (existing.status !== "draft") {
    throw errors.businessViolation("يمكن تعديل القوالب وهي في حالة مسودة فقط");
  }

  const [template] = await db
    .update(whatsappTemplatesTable)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.channelAccountId !== undefined && { channelAccountId: input.channelAccountId ?? null }),
      ...(input.components !== undefined && { components: input.components }),
      ...(input.variables !== undefined && { variables: input.variables }),
      updatedAt: new Date(),
    })
    .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
    .returning();

  return template;
}

export async function deleteTemplate(workspaceId: string, id: string) {
  const { template } = await getTemplate(workspaceId, id);
  if (!["draft", "rejected"].includes(template.status)) {
    throw errors.businessViolation("يمكن حذف القالب إذا كان مسودة أو مرفوضاً فقط");
  }

  await db
    .delete(whatsappTemplatesTable)
    .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)));

  return template;
}

export async function duplicateTemplate(workspaceId: string, userId: string, id: string) {
  const { template } = await getTemplate(workspaceId, id);
  const copyName = `${template.name}-copy-${Date.now().toString(36)}`;

  const [copy] = await db
    .insert(whatsappTemplatesTable)
    .values({
      workspaceId,
      name: copyName,
      language: template.language,
      category: template.category,
      channelAccountId: template.channelAccountId,
      components: template.components,
      variables: template.variables,
      status: "draft",
      createdBy: userId,
    })
    .returning();

  return copy;
}

export async function submitTemplate(workspaceId: string, id: string) {
  const { template } = await getTemplate(workspaceId, id);
  if (template.status !== "draft") {
    throw errors.businessViolation("يمكن إرسال القوالب المسودة فقط للمراجعة");
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(templateVersionsTable)
    .where(and(eq(templateVersionsTable.templateId, id), eq(templateVersionsTable.workspaceId, workspaceId)));

  const versionNumber = Number(total) + 1;
  const submittedAt = new Date();
  const [channelAccount] = template.channelAccountId
    ? await db
        .select()
        .from(channelAccountsTable)
        .where(and(eq(channelAccountsTable.id, template.channelAccountId), eq(channelAccountsTable.workspaceId, workspaceId)))
        .limit(1)
    : [];
  const metaResult = await submitMetaTemplate(channelAccount ?? null, {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components,
  });

  const [updated] = await db.transaction(async (tx) => {
    const [nextTemplate] = await tx
      .update(whatsappTemplatesTable)
      .set({
        status: "submitted",
        submittedAt,
        metaTemplateId: metaResult.id ?? template.metaTemplateId,
        updatedAt: submittedAt,
      })
      .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
      .returning();

    await tx.insert(templateVersionsTable).values({
      templateId: id,
      workspaceId,
      versionNumber,
      status: "submitted",
      components: template.components,
      responseJson: { mode: metaResult.dryRun ? "dry_run" : "meta", externalCall: !metaResult.dryRun, requestId: metaResult.requestId, payload: metaResult.payload },
      submittedAt,
    });

    return [nextTemplate];
  });

  return updated;
}

export async function syncTemplate(workspaceId: string, id: string) {
  const { template } = await getTemplate(workspaceId, id);
  const [channelAccount] = template.channelAccountId
    ? await db
        .select()
        .from(channelAccountsTable)
        .where(and(eq(channelAccountsTable.id, template.channelAccountId), eq(channelAccountsTable.workspaceId, workspaceId)))
        .limit(1)
    : [];
  if (!template.metaTemplateId) return { template, synced: false, mode: "dry_run" as const };

  const metaResult = await fetchTemplateStatus(channelAccount ?? null, template.metaTemplateId);
  const payload = metaResult.payload as Record<string, unknown> | undefined;
  const status = typeof payload?.status === "string" ? payload.status.toLowerCase() : template.status;
  const rejectionReason = typeof payload?.rejected_reason === "string" ? payload.rejected_reason : template.rejectionReason;
  const [updated] = await db
    .update(whatsappTemplatesTable)
    .set({ status, rejectionReason, updatedAt: new Date() })
    .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
    .returning();
  return { template: updated, synced: true, mode: metaResult.dryRun ? "dry_run" as const : "meta" as const };
}
