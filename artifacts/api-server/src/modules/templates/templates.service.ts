import { and, count, desc, eq, ilike, not } from "drizzle-orm";
import { channelAccountsTable, db, templateVersionsTable, whatsappTemplatesTable } from "@workspace/db";
import { errors } from "../../lib/errors";
import {
  assertMetaOk,
  deleteMetaTemplate,
  editMetaTemplate,
  fetchTemplateStatus,
  listAllMetaTemplates,
  submitTemplate as submitMetaTemplate,
  uploadHeaderMedia,
} from "../../services/meta-graph";
import { logger } from "../../lib/logger";
import type { createTemplateSchema, listTemplatesQuerySchema, updateTemplateSchema } from "./templates.schema";
import type { z } from "zod";

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
type ListTemplatesFilters = z.infer<typeof listTemplatesQuerySchema>;

// Templates are editable in any status except while pending Meta review
const BLOCKED_EDIT_STATUSES = ["submitted"];

async function loadChannelAccount(workspaceId: string, channelAccountId: string | null | undefined) {
  if (!channelAccountId) return null;
  const [account] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(eq(channelAccountsTable.id, channelAccountId), eq(channelAccountsTable.workspaceId, workspaceId)))
    .limit(1);
  return account ?? null;
}

export async function listTemplates(workspaceId: string, filters: ListTemplatesFilters) {
  const conditions = [eq(whatsappTemplatesTable.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(whatsappTemplatesTable.status, filters.status));
  if (filters.language) conditions.push(eq(whatsappTemplatesTable.language, filters.language));
  if (filters.category) conditions.push(eq(whatsappTemplatesTable.category, filters.category));
  if (filters.search) conditions.push(ilike(whatsappTemplatesTable.name, `%${filters.search}%`));

  const offset = (filters.page - 1) * filters.limit;

  const [templates, [{ total }]] = await Promise.all([
    db
      .select()
      .from(whatsappTemplatesTable)
      .where(and(...conditions))
      .orderBy(desc(whatsappTemplatesTable.updatedAt))
      .limit(filters.limit)
      .offset(offset),
    db.select({ total: count() }).from(whatsappTemplatesTable).where(and(...conditions)),
  ]);

  return { templates, total: Number(total), page: filters.page, limit: filters.limit };
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

  if (BLOCKED_EDIT_STATUSES.includes(existing.status)) {
    throw errors.businessViolation("لا يمكن تعديل القالب بينما هو قيد المراجعة لدى ميتا");
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

  // For approved/rejected/paused templates with a metaTemplateId, re-submit components to Meta
  const shouldResubmit =
    existing.metaTemplateId &&
    existing.status !== "draft" &&
    input.components !== undefined;

  if (shouldResubmit) {
    const channelAccount = await loadChannelAccount(workspaceId, existing.channelAccountId);
    const metaResult = await editMetaTemplate(channelAccount, existing.metaTemplateId!, input.components);
    assertMetaOk(metaResult, "edit_template");

    const [resubmitted] = await db
      .update(whatsappTemplatesTable)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
      .returning();

    return resubmitted;
  }

  return template;
}

export async function deleteTemplate(workspaceId: string, id: string) {
  const { template } = await getTemplate(workspaceId, id);

  // Best-effort Meta delete for templates that were ever submitted
  if (template.metaTemplateId && template.status !== "draft") {
    try {
      const channelAccount = await loadChannelAccount(workspaceId, template.channelAccountId);
      const metaResult = await deleteMetaTemplate(channelAccount, template.name, template.metaTemplateId);
      if (!metaResult.ok && !metaResult.dryRun) {
        logger.warn(
          { templateId: id, metaTemplateId: template.metaTemplateId, payload: metaResult.payload },
          "Meta delete template failed — continuing with local delete",
        );
      }
    } catch (err) {
      logger.warn({ templateId: id, err }, "Meta delete template threw — continuing with local delete");
    }
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

  // Prevent duplicate submission — check for another submitted/approved template with same name
  const [duplicate] = await db
    .select({ id: whatsappTemplatesTable.id })
    .from(whatsappTemplatesTable)
    .where(
      and(
        eq(whatsappTemplatesTable.workspaceId, workspaceId),
        eq(whatsappTemplatesTable.name, template.name),
        not(eq(whatsappTemplatesTable.id, id)),
        not(eq(whatsappTemplatesTable.status, "draft")),
        not(eq(whatsappTemplatesTable.status, "rejected")),
      ),
    )
    .limit(1);

  if (duplicate) {
    throw errors.conflict(`قالب بالاسم "${template.name}" مُقدَّم مسبقاً ولم يُرفض. غيّر الاسم أو أعد استخدام القالب الموجود.`);
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(templateVersionsTable)
    .where(and(eq(templateVersionsTable.templateId, id), eq(templateVersionsTable.workspaceId, workspaceId)));

  const versionNumber = Number(total) + 1;
  const submittedAt = new Date();
  const channelAccount = await loadChannelAccount(workspaceId, template.channelAccountId);

  const metaResult = await submitMetaTemplate(channelAccount, {
    name: template.name,
    language: template.language,
    category: template.category,
    components: template.components,
  });

  assertMetaOk(metaResult, "submit_template");

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
      responseJson: {
        mode: metaResult.dryRun ? "dry_run" : "meta",
        externalCall: !metaResult.dryRun,
        requestId: metaResult.requestId,
        payload: metaResult.payload,
      },
      submittedAt,
    });

    return [nextTemplate];
  });

  return updated;
}

export async function syncTemplate(workspaceId: string, id: string) {
  const { template } = await getTemplate(workspaceId, id);
  const channelAccount = await loadChannelAccount(workspaceId, template.channelAccountId);

  if (!template.metaTemplateId) return { template, synced: false, mode: "dry_run" as const };

  const metaResult = await fetchTemplateStatus(channelAccount, template.metaTemplateId);
  const payload = metaResult.payload as Record<string, unknown> | undefined;
  const status = typeof payload?.status === "string" ? payload.status.toLowerCase() : template.status;
  const rejectionReason = typeof payload?.rejected_reason === "string" ? payload.rejected_reason : template.rejectionReason;

  const [updated] = await db
    .update(whatsappTemplatesTable)
    .set({ status, rejectionReason, updatedAt: new Date() })
    .where(and(eq(whatsappTemplatesTable.id, id), eq(whatsappTemplatesTable.workspaceId, workspaceId)))
    .returning();

  return { template: updated, synced: true, mode: metaResult.dryRun ? ("dry_run" as const) : ("meta" as const) };
}

export async function syncAllTemplates(workspaceId: string, channelAccountId?: string) {
  const channelAccount = await loadChannelAccount(workspaceId, channelAccountId ?? null);
  const metaResult = await listAllMetaTemplates(channelAccount);

  if (!metaResult.ok || metaResult.dryRun) {
    return { synced: false, mode: metaResult.dryRun ? ("dry_run" as const) : ("meta_error" as const), updated: 0 };
  }

  const metaTemplates =
    ((metaResult.payload as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ?? [];

  let updated = 0;
  for (const mt of metaTemplates) {
    const metaId = mt.id as string | undefined;
    const metaStatus = typeof mt.status === "string" ? mt.status.toLowerCase() : undefined;
    const rejectionReason = typeof mt.rejected_reason === "string" ? mt.rejected_reason : null;

    if (!metaId || !metaStatus) continue;

    const [existing] = await db
      .select({ id: whatsappTemplatesTable.id, status: whatsappTemplatesTable.status })
      .from(whatsappTemplatesTable)
      .where(and(eq(whatsappTemplatesTable.workspaceId, workspaceId), eq(whatsappTemplatesTable.metaTemplateId, metaId)))
      .limit(1);

    if (existing && existing.status !== metaStatus) {
      await db
        .update(whatsappTemplatesTable)
        .set({ status: metaStatus, rejectionReason, updatedAt: new Date() })
        .where(and(eq(whatsappTemplatesTable.id, existing.id), eq(whatsappTemplatesTable.workspaceId, workspaceId)));
      updated++;
    }
  }

  return { synced: true, mode: "meta" as const, updated };
}

export async function uploadHeaderMediaService(
  workspaceId: string,
  channelAccountId: string | undefined,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ header_handle: string; dryRun: boolean }> {
  const channelAccount = await loadChannelAccount(workspaceId, channelAccountId ?? null);
  const result = await uploadHeaderMedia(channelAccount, fileBuffer, mimeType, fileName);
  assertMetaOk(result, "upload_header_media");

  const handle = result.dryRun
    ? ((result.payload as Record<string, unknown>)?.header_handle as string)
    : result.id!;

  return { header_handle: handle, dryRun: result.dryRun };
}
