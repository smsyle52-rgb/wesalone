import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  knowledgeBasesTable, knowledgeSourcesTable, knowledgeDocumentsTable,
  knowledgeChunksTable, faqEntriesTable,
} from "@workspace/db";
import { eq, and, desc, ne, or, ilike, asc, isNull, type SQL } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { estimateKnowledgeTokens, rebuildDocumentChunks } from "../../services/kb-chunker";
import { searchKnowledge } from "../../services/knowledge-retrieval";

const router = Router();
router.use(requireSession);

const CHUNK_SIZE = 1800;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start + CHUNK_SIZE / 2) end = lastSpace;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function createChunksForDocument(
  documentId: string, workspaceId: string, knowledgeBaseId: string, contentText: string
): Promise<void> {
  const chunks = chunkText(contentText);
  if (chunks.length === 0) return;
  await db.insert(knowledgeChunksTable).values(
    chunks.map((chunkText, chunkIndex) => ({
      workspaceId,
      knowledgeBaseId,
      documentId,
      chunkIndex,
      chunkText,
      tokenEstimate: estimateTokens(chunkText),
      embeddingStatus: "pending" as const,
      metadata: {},
    }))
  );
}

// ─── Knowledge Bases ────────────────────────────────────────────────────────

const baseCreateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
});

const baseUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
});

router.get("/bases", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const includeArchived = req.query.includeArchived === "true";
  const conditions = [eq(knowledgeBasesTable.workspaceId, activeWorkspaceId)];
  if (!includeArchived) conditions.push(eq(knowledgeBasesTable.status, "active"));
  const bases = await db.select().from(knowledgeBasesTable)
    .where(and(...conditions))
    .orderBy(desc(knowledgeBasesTable.createdAt));
  res.json({ bases });
});

router.post("/bases", requirePermission("knowledge:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const parsed = baseCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const [base] = await db.insert(knowledgeBasesTable).values({
    workspaceId: activeWorkspaceId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    status: "active",
    createdBy: userId,
  }).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_base_create",
    entityType: "knowledge_base",
    entityId: base.id,
    entityLabel: base.name,
    newData: { name: base.name },
  });
  res.status(201).json({ base });
});

router.get("/bases/:id", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const [base] = await db.select().from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  res.json({ base });
});

router.patch("/bases/:id", requirePermission("knowledge:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const [existing] = await db.select().from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const parsed = baseUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const updates: Partial<typeof existing> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if ("description" in parsed.data) updates.description = parsed.data.description ?? null;
  const [updated] = await db.update(knowledgeBasesTable).set(updates)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_base_update",
    entityType: "knowledge_base", entityId: id, entityLabel: updated.name,
    oldData: { name: existing.name }, newData: { name: updated.name },
  });
  res.json({ base: updated });
});

router.patch("/bases/:id/archive", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const [existing] = await db.select().from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const [updated] = await db.update(knowledgeBasesTable).set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).returning();
  // إصلاح «الأرشفة لا تُؤرشف» (10 يوليو 2026): أرشفة القاعدة كانت شكلية — تختفي من الشريط
  // الجانبي بينما وثائقها وأسئلتها تبقى حيّة يجيب منها الوكيل (الاسترجاع لا يفحص حالة القاعدة).
  // الأرشفة تتسلسل الآن للمصادر والوثائق والأسئلة الشائعة (الاسترجاع يستبعد المؤرشف منها فعلاً).
  const now = new Date();
  await db.update(knowledgeSourcesTable).set({ status: "archived", updatedAt: now })
    .where(and(eq(knowledgeSourcesTable.knowledgeBaseId, id), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)));
  await db.update(knowledgeDocumentsTable).set({ status: "archived", updatedAt: now })
    .where(and(eq(knowledgeDocumentsTable.knowledgeBaseId, id), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)));
  await db.update(faqEntriesTable).set({ status: "archived", updatedAt: now })
    .where(and(eq(faqEntriesTable.knowledgeBaseId, id), eq(faqEntriesTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_base_archive",
    entityType: "knowledge_base", entityId: id, entityLabel: existing.name,
  });
  res.json({ base: updated });
});

// ─── Knowledge Sources ───────────────────────────────────────────────────────

const sourceCreateSchema = z.object({
  type: z.enum(["text", "faq", "file", "url"]).default("text"),
  title: z.string().trim().min(1, "العنوان مطلوب").max(500),
  rawText: z.string().trim().max(100000).optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const sourceUpdateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  rawText: z.string().trim().max(100000).optional().nullable(),
  status: z.enum(["draft", "processing", "ready", "failed", "archived"]).optional(),
});

router.get("/bases/:id/sources", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const sources = await db.select().from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.knowledgeBaseId, baseId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)))
    .orderBy(desc(knowledgeSourcesTable.createdAt));
  res.json({ sources });
});

router.post("/bases/:id/sources", requirePermission("knowledge:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const parsed = sourceCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  // إصلاح (9 يوليو 2026): كان مصدر «نص عادي» يُحفظ سطراً في knowledge_sources فقط — بلا وثيقة
  // ولا chunks — فلا يراه الاسترجاع أبداً، والوكيل لا يقرأ أي معرفة تُضاف بهذا الخيار (وهو الافتراضي).
  // الآن نفهرسه فعلياً بنفس مسار الملف الناجح: مصدر → وثيقة → rebuildDocumentChunks (تقطيع + embedding)،
  // مع تنظيف عند الفشل حتى لا يبقى مصدر يتيم. الأنواع الأخرى (url/faq) تبقى بسلوكها الحالي.
  const indexText = (parsed.data.type === "text" ? (parsed.data.rawText ?? "") : "")
    .split(String.fromCharCode(0)).join("").trim();
  const shouldIndex = parsed.data.type === "text" && indexText.length > 0;

  const [source] = await db.insert(knowledgeSourcesTable).values({
    workspaceId: activeWorkspaceId,
    knowledgeBaseId: baseId,
    type: parsed.data.type,
    title: parsed.data.title,
    status: shouldIndex ? "processing" : "draft",
    rawText: parsed.data.rawText ?? null,
    sourceUrl: parsed.data.sourceUrl ?? null,
    metadata: parsed.data.metadata ?? {},
    createdBy: userId,
  }).returning();

  if (shouldIndex) {
    try {
      const [doc] = await db.insert(knowledgeDocumentsTable).values({
        workspaceId: activeWorkspaceId,
        knowledgeBaseId: baseId,
        sourceId: source.id,
        title: parsed.data.title,
        contentText: indexText,
        status: "ready",
        tokenEstimate: estimateKnowledgeTokens(indexText),
        createdBy: userId,
      }).returning();
      const { chunkCount } = await rebuildDocumentChunks({
        documentId: doc.id, workspaceId: activeWorkspaceId, knowledgeBaseId: baseId, contentText: indexText,
      });
      const [readySource] = await db.update(knowledgeSourcesTable)
        .set({ status: "ready", updatedAt: new Date() })
        .where(and(eq(knowledgeSourcesTable.id, source.id), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)))
        .returning();
      await createAuditLog({
        ...auditFromRequest(req, req.sessionUser),
        action: "knowledge_source_create",
        entityType: "knowledge_source", entityId: source.id, entityLabel: source.title,
        newData: { type: source.type, title: source.title, indexed: true, chunks: chunkCount },
      });
      res.status(201).json({ source: readySource, chunkCount });
      return;
    } catch (err) {
      // تنظيف: احذف الوثيقة (ومقاطعها بالتعاقب) ثم المصدر حتى لا يبقى يتيماً، ثم مرّر الخطأ للمعالج العام.
      await db.delete(knowledgeDocumentsTable)
        .where(and(eq(knowledgeDocumentsTable.sourceId, source.id), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)));
      await db.delete(knowledgeSourcesTable)
        .where(and(eq(knowledgeSourcesTable.id, source.id), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)));
      throw err;
    }
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_source_create",
    entityType: "knowledge_source", entityId: source.id, entityLabel: source.title,
    newData: { type: source.type, title: source.title },
  });
  res.status(201).json({ source });
});

// ─── رفع ملف كمصدر معرفة ──────────────────────────────────────────────────────
// النص يُستخرج في المتصفح (PDF/Word/نص) ويصل هنا جاهزاً، فيبقى bundle الخادم بلا
// مكتبات استخراج. ننشئ مصدراً (type=file) + وثيقة/وثائق + chunks عبر خط المعالجة
// القائم، في طلب واحد، مع تنظيف عند الفشل حتى لا يبقى مصدر يتيم.
const MAX_DOC_CHARS = 190000;   // أقل من سقف docCreateSchema (200000) بهامش
const MAX_FILE_DOCUMENTS = 5;   // سقف عدد الوثائق لمنع تحميل embeddings مفرط

const sourceFromFileSchema = z.object({
  title: z.string().trim().min(1, "العنوان مطلوب").max(500),
  text: z.string().min(1, "تعذّر استخراج نص من الملف"),
  fileName: z.string().trim().max(500).optional(),
  mimeType: z.string().trim().max(200).optional(),
  byteSize: z.number().int().nonnegative().optional(),
});

router.post("/bases/:id/sources/from-file", requirePermission("knowledge:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }

  const parsed = sourceFromFileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  // Postgres لا يقبل NUL في حقول النص — نزيله دفاعياً (المتصفح يزيله أيضاً).
  const cleanText = parsed.data.text.split(String.fromCharCode(0)).join("").trim();
  if (!cleanText) {
    res.status(400).json({ error: "الملف لا يحتوي على نص قابل للاستخراج (قد يكون صورة ممسوحة).", code: "EMPTY_TEXT" });
    return;
  }

  // قسّم النص الطويل إلى وثائق ضمن حدّ المخطط، بسقف عدد لمنع تحميل مفرط.
  const segments: string[] = [];
  for (let i = 0; i < cleanText.length && segments.length < MAX_FILE_DOCUMENTS; i += MAX_DOC_CHARS) {
    segments.push(cleanText.slice(i, i + MAX_DOC_CHARS));
  }
  const truncated = cleanText.length > MAX_DOC_CHARS * MAX_FILE_DOCUMENTS;

  // أنشئ المصدر أولاً (حالة processing حتى تكتمل الوثائق).
  const [source] = await db.insert(knowledgeSourcesTable).values({
    workspaceId: activeWorkspaceId,
    knowledgeBaseId: baseId,
    type: "file",
    title: parsed.data.title,
    status: "processing",
    metadata: {
      fileName: parsed.data.fileName ?? null,
      mimeType: parsed.data.mimeType ?? null,
      byteSize: parsed.data.byteSize ?? null,
      charCount: cleanText.length,
      truncated,
    },
    createdBy: userId,
  }).returning();

  try {
    let chunkCount = 0;
    for (let idx = 0; idx < segments.length; idx++) {
      const segment = segments[idx];
      const docTitle = segments.length > 1 ? `${parsed.data.title} (${idx + 1}/${segments.length})` : parsed.data.title;
      const [doc] = await db.insert(knowledgeDocumentsTable).values({
        workspaceId: activeWorkspaceId,
        knowledgeBaseId: baseId,
        sourceId: source.id,
        title: docTitle,
        contentText: segment,
        status: "ready",
        tokenEstimate: estimateKnowledgeTokens(segment),
        createdBy: userId,
      }).returning();
      const { chunkCount: produced } = await rebuildDocumentChunks({
        documentId: doc.id, workspaceId: activeWorkspaceId, knowledgeBaseId: baseId, contentText: segment,
      });
      chunkCount += produced;
    }

    const [readySource] = await db.update(knowledgeSourcesTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(knowledgeSourcesTable.id, source.id), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)))
      .returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "knowledge_source_create",
      entityType: "knowledge_source", entityId: source.id, entityLabel: source.title,
      newData: { type: "file", title: source.title, fileName: parsed.data.fileName ?? null, documents: segments.length, chunks: chunkCount },
    });

    res.status(201).json({ source: readySource, documentCount: segments.length, chunkCount, truncated });
  } catch (err) {
    // تنظيف: احذف الوثائق (ومقاطعها بالتعاقب) ثم المصدر حتى لا يبقى يتيماً، ثم مرّر الخطأ للمعالج العام.
    await db.delete(knowledgeDocumentsTable)
      .where(and(eq(knowledgeDocumentsTable.sourceId, source.id), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)));
    await db.delete(knowledgeSourcesTable)
      .where(and(eq(knowledgeSourcesTable.id, source.id), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)));
    throw err;
  }
});

router.patch("/sources/:sourceId", requirePermission("knowledge:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const sourceId = String(req.params.sourceId);
  const [existing] = await db.select().from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "المصدر غير موجود", code: "NOT_FOUND" }); return; }
  const parsed = sourceUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const updates: Partial<typeof existing> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if ("rawText" in parsed.data) updates.rawText = parsed.data.rawText ?? null;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  const [updated] = await db.update(knowledgeSourcesTable).set(updates)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId))).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_source_update",
    entityType: "knowledge_source", entityId: sourceId, entityLabel: updated.title,
  });
  res.json({ source: updated });
});

router.patch("/sources/:sourceId/archive", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const sourceId = String(req.params.sourceId);
  const [existing] = await db.select().from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "المصدر غير موجود", code: "NOT_FOUND" }); return; }
  const [updated] = await db.update(knowledgeSourcesTable).set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId))).returning();
  // إصلاح «الأرشفة لا تُؤرشف» (10 يوليو 2026): الاسترجاع يقرأ knowledge_documents فقط ولا يفحص
  // حالة المصدر أبداً — فأرشفة المصدر وحدها كانت شكلية والوكيل يظل يجيب من وثائقه. الأرشفة
  // تتسلسل الآن للوثائق المشتقة (والاسترجاع يستبعد الوثائق المؤرشفة أصلاً).
  await db.update(knowledgeDocumentsTable).set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(knowledgeDocumentsTable.sourceId, sourceId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_source_archive",
    entityType: "knowledge_source", entityId: sourceId, entityLabel: existing.title,
  });
  res.json({ source: updated });
});

// ─── Knowledge Documents ─────────────────────────────────────────────────────

const docCreateSchema = z.object({
  title: z.string().trim().min(1, "العنوان مطلوب").max(500),
  contentText: z.string().trim().min(1, "محتوى الوثيقة مطلوب").max(200000),
  sourceId: z.string().uuid().optional().nullable(),
});

const docUpdateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  contentText: z.string().trim().min(1).max(200000).optional(),
  status: z.enum(["draft", "ready", "archived"]).optional(),
});

router.get("/bases/:id/documents", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const docs = await db.select().from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.knowledgeBaseId, baseId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)))
    .orderBy(desc(knowledgeDocumentsTable.createdAt));
  res.json({ documents: docs });
});

router.post("/bases/:id/documents", requirePermission("knowledge:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const parsed = docCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const tokenEstimate = estimateKnowledgeTokens(parsed.data.contentText);
  const [doc] = await db.insert(knowledgeDocumentsTable).values({
    workspaceId: activeWorkspaceId,
    knowledgeBaseId: baseId,
    sourceId: parsed.data.sourceId ?? null,
    title: parsed.data.title,
    contentText: parsed.data.contentText,
    status: "ready",
    tokenEstimate,
    createdBy: userId,
  }).returning();
  await rebuildDocumentChunks({ documentId: doc.id, workspaceId: activeWorkspaceId, knowledgeBaseId: baseId, contentText: parsed.data.contentText });
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_document_create",
    entityType: "knowledge_document", entityId: doc.id, entityLabel: doc.title,
    newData: { title: doc.title, tokenEstimate },
  });
  res.status(201).json({ document: doc });
});

router.get("/documents/:documentId", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const docId = String(req.params.documentId);
  const [doc] = await db.select().from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!doc) { res.status(404).json({ error: "الوثيقة غير موجودة", code: "NOT_FOUND" }); return; }
  res.json({ document: doc });
});

router.patch("/documents/:documentId", requirePermission("knowledge:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const docId = String(req.params.documentId);
  const [existing] = await db.select().from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الوثيقة غير موجودة", code: "NOT_FOUND" }); return; }
  const parsed = docUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const updates: Partial<typeof existing> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.contentText !== undefined) {
    updates.contentText = parsed.data.contentText;
    updates.tokenEstimate = estimateKnowledgeTokens(parsed.data.contentText);
  }
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  const [updated] = await db.update(knowledgeDocumentsTable).set(updates)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).returning();
  if (parsed.data.contentText !== undefined) {
    await rebuildDocumentChunks({ documentId: docId, workspaceId: activeWorkspaceId, knowledgeBaseId: updated.knowledgeBaseId, contentText: parsed.data.contentText });
  }
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_document_update",
    entityType: "knowledge_document", entityId: docId, entityLabel: updated.title,
  });
  res.json({ document: updated });
});

router.patch("/documents/:documentId/archive", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const docId = String(req.params.documentId);
  const [existing] = await db.select().from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الوثيقة غير موجودة", code: "NOT_FOUND" }); return; }
  const [updated] = await db.update(knowledgeDocumentsTable).set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_document_archive",
    entityType: "knowledge_document", entityId: docId, entityLabel: existing.title,
  });
  res.json({ document: updated });
});

// ─── Chunks ──────────────────────────────────────────────────────────────────

router.get("/documents/:documentId/chunks", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const docId = String(req.params.documentId);
  const [doc] = await db.select({ id: knowledgeDocumentsTable.id }).from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!doc) { res.status(404).json({ error: "الوثيقة غير موجودة", code: "NOT_FOUND" }); return; }
  const chunks = await db.select().from(knowledgeChunksTable)
    .where(and(eq(knowledgeChunksTable.documentId, docId), eq(knowledgeChunksTable.workspaceId, activeWorkspaceId)))
    .orderBy(asc(knowledgeChunksTable.chunkIndex));
  res.json({ chunks });
});

router.post("/documents/:documentId/rechunk", requirePermission("knowledge:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const docId = String(req.params.documentId);
  const [doc] = await db.select().from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!doc) { res.status(404).json({ error: "الوثيقة غير موجودة", code: "NOT_FOUND" }); return; }
  await rebuildDocumentChunks({ documentId: docId, workspaceId: activeWorkspaceId, knowledgeBaseId: doc.knowledgeBaseId, contentText: doc.contentText });
  const chunks = await db.select().from(knowledgeChunksTable)
    .where(and(eq(knowledgeChunksTable.documentId, docId), eq(knowledgeChunksTable.workspaceId, activeWorkspaceId)))
    .orderBy(asc(knowledgeChunksTable.chunkIndex));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_document_rechunk",
    entityType: "knowledge_document", entityId: docId, entityLabel: doc.title,
    newData: { chunkCount: chunks.length },
  });
  res.json({ chunks, chunkCount: chunks.length });
});

// Launch fix (2 Jul): re-embed the whole workspace's knowledge in one action. Needed
// once after enabling real Vertex embeddings — documents indexed under dry-run carry
// pseudo-vectors that semantic search can never match until they are rebuilt.
router.post("/reindex", requirePermission("knowledge:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const docs = await db
    .select({
      id: knowledgeDocumentsTable.id,
      knowledgeBaseId: knowledgeDocumentsTable.knowledgeBaseId,
      contentText: knowledgeDocumentsTable.contentText,
    })
    .from(knowledgeDocumentsTable)
    .where(and(
      eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId),
      ne(knowledgeDocumentsTable.status, "archived"),
    ));

  let reindexed = 0;
  const failedIds: string[] = [];
  for (const doc of docs) {
    try {
      await rebuildDocumentChunks({
        documentId: doc.id,
        workspaceId: activeWorkspaceId,
        knowledgeBaseId: doc.knowledgeBaseId,
        contentText: doc.contentText,
      });
      reindexed += 1;
    } catch {
      failedIds.push(doc.id);
    }
  }

  // معالجة المعرفة اليتيمة (10 يوليو 2026): مصادر «نص عادي» المُنشأة قبل إصلاح الفهرسة لها
  // rawText لكن بلا وثيقة إطلاقاً — تظهر «جاهزة» في الواجهة والوكيل لا يراها أبداً، وإعادة
  // الفهرسة كانت تتجاهلها (تمرّ على الوثائق فقط). الآن زرّ «إعادة فهرسة شاملة» يعالجها:
  // ينشئ الوثيقة والمقاطع بنفس مسار الإنشاء المُصلَح، فيشفي معرفة التاجر القديمة بضغطة واحدة.
  const orphanSources = await db
    .select({
      id: knowledgeSourcesTable.id,
      knowledgeBaseId: knowledgeSourcesTable.knowledgeBaseId,
      title: knowledgeSourcesTable.title,
      rawText: knowledgeSourcesTable.rawText,
    })
    .from(knowledgeSourcesTable)
    .leftJoin(knowledgeDocumentsTable, eq(knowledgeDocumentsTable.sourceId, knowledgeSourcesTable.id))
    .where(and(
      eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId),
      eq(knowledgeSourcesTable.type, "text"),
      ne(knowledgeSourcesTable.status, "archived"),
      isNull(knowledgeDocumentsTable.id),
    ));

  let backfilled = 0;
  for (const orphan of orphanSources) {
    const text = (orphan.rawText ?? "").split(String.fromCharCode(0)).join("").trim();
    if (!text) continue;
    try {
      const [doc] = await db.insert(knowledgeDocumentsTable).values({
        workspaceId: activeWorkspaceId,
        knowledgeBaseId: orphan.knowledgeBaseId,
        sourceId: orphan.id,
        title: orphan.title,
        contentText: text,
        status: "ready",
        tokenEstimate: estimateKnowledgeTokens(text),
        createdBy: userId,
      }).returning();
      await rebuildDocumentChunks({
        documentId: doc.id, workspaceId: activeWorkspaceId, knowledgeBaseId: orphan.knowledgeBaseId, contentText: text,
      });
      await db.update(knowledgeSourcesTable).set({ status: "ready", updatedAt: new Date() })
        .where(and(eq(knowledgeSourcesTable.id, orphan.id), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)));
      backfilled += 1;
    } catch {
      failedIds.push(orphan.id);
    }
  }

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_document_rechunk",
    entityType: "workspace", entityId: activeWorkspaceId, entityLabel: "إعادة فهرسة شاملة",
    newData: { total: docs.length, reindexed, backfilledOrphanSources: backfilled, failed: failedIds.length },
  });

  res.json({ total: docs.length, reindexed, backfilled, failed: failedIds.length });
});

// ─── FAQ Entries ─────────────────────────────────────────────────────────────

const faqCreateSchema = z.object({
  question: z.string().trim().min(1, "السؤال مطلوب").max(2000),
  answer: z.string().trim().min(1, "الإجابة مطلوبة").max(10000),
  category: z.string().trim().max(200).optional().nullable(),
});

const faqUpdateSchema = z.object({
  question: z.string().trim().min(1).max(2000).optional(),
  answer: z.string().trim().min(1).max(10000).optional(),
  category: z.string().trim().max(200).optional().nullable(),
});

router.get("/bases/:id/faqs", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const includeArchived = req.query.includeArchived === "true";
  const conditions = [
    eq(faqEntriesTable.knowledgeBaseId, baseId),
    eq(faqEntriesTable.workspaceId, activeWorkspaceId),
  ];
  if (!includeArchived) conditions.push(eq(faqEntriesTable.status, "active"));
  const faqs = await db.select().from(faqEntriesTable)
    .where(and(...conditions))
    .orderBy(desc(faqEntriesTable.createdAt));
  res.json({ faqs });
});

router.post("/bases/:id/faqs", requirePermission("knowledge:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const baseId = String(req.params.id);
  const [base] = await db.select({ id: knowledgeBasesTable.id }).from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, baseId), eq(knowledgeBasesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!base) { res.status(404).json({ error: "قاعدة المعرفة غير موجودة", code: "NOT_FOUND" }); return; }
  const parsed = faqCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const [faq] = await db.insert(faqEntriesTable).values({
    workspaceId: activeWorkspaceId,
    knowledgeBaseId: baseId,
    question: parsed.data.question,
    answer: parsed.data.answer,
    category: parsed.data.category ?? null,
    status: "active",
    createdBy: userId,
  }).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "faq_create",
    entityType: "faq_entry", entityId: faq.id, entityLabel: faq.question.slice(0, 100),
  });
  res.status(201).json({ faq });
});

router.patch("/faqs/:faqId", requirePermission("knowledge:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const faqId = String(req.params.faqId);
  const [existing] = await db.select().from(faqEntriesTable)
    .where(and(eq(faqEntriesTable.id, faqId), eq(faqEntriesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "السؤال غير موجود", code: "NOT_FOUND" }); return; }
  const parsed = faqUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }
  const updates: Partial<typeof existing> = { updatedAt: new Date() };
  if (parsed.data.question !== undefined) updates.question = parsed.data.question;
  if (parsed.data.answer !== undefined) updates.answer = parsed.data.answer;
  if ("category" in parsed.data) updates.category = parsed.data.category ?? null;
  const [updated] = await db.update(faqEntriesTable).set(updates)
    .where(and(eq(faqEntriesTable.id, faqId), eq(faqEntriesTable.workspaceId, activeWorkspaceId))).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "faq_update",
    entityType: "faq_entry", entityId: faqId, entityLabel: updated.question.slice(0, 100),
  });
  res.json({ faq: updated });
});

router.patch("/faqs/:faqId/archive", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const faqId = String(req.params.faqId);
  const [existing] = await db.select().from(faqEntriesTable)
    .where(and(eq(faqEntriesTable.id, faqId), eq(faqEntriesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "السؤال غير موجود", code: "NOT_FOUND" }); return; }
  const [updated] = await db.update(faqEntriesTable).set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(faqEntriesTable.id, faqId), eq(faqEntriesTable.workspaceId, activeWorkspaceId))).returning();
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "faq_archive",
    entityType: "faq_entry", entityId: faqId, entityLabel: existing.question.slice(0, 100),
  });
  res.json({ faq: updated });
});

// ─── Search ──────────────────────────────────────────────────────────────────

router.post("/search", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const parsed = z.object({
    query: z.string().trim().min(2),
    knowledge_base_ids: z.array(z.string().uuid()).optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "بيانات البحث غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  const results = await searchKnowledge({
    workspaceId: activeWorkspaceId,
    query: parsed.data.query,
    knowledgeBaseIds: parsed.data.knowledge_base_ids,
    limit: parsed.data.limit ?? 5,
  });

  res.json({
    query: parsed.data.query,
    mode: "hybrid",
    results: {
      documents: results.filter((item) => item.type === "document"),
      faqs: results.filter((item) => item.type === "faq"),
      chunks: results.filter((item) => item.type === "chunk"),
      combined: results,
    },
    total: results.length,
  });
});

router.get("/search", requirePermission("knowledge:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const q = String(req.query.q ?? "").trim();
  const baseId = req.query.baseId as string | undefined;

  if (!q || q.length < 2) {
    res.status(400).json({ error: "يجب أن يحتوي البحث على حرفين على الأقل", code: "QUERY_TOO_SHORT" });
    return;
  }

  const pattern = `%${q}%`;

  const docTextFilter = or(
    ilike(knowledgeDocumentsTable.title, pattern),
    ilike(knowledgeDocumentsTable.contentText, pattern)
  );
  const faqTextFilter = or(
    ilike(faqEntriesTable.question, pattern),
    ilike(faqEntriesTable.answer, pattern)
  );

  const docWhere: SQL[] = [
    eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId),
    docTextFilter as SQL,
  ];
  const faqWhere: SQL[] = [
    eq(faqEntriesTable.workspaceId, activeWorkspaceId),
    eq(faqEntriesTable.status, "active"),
    faqTextFilter as SQL,
  ];
  const chunkWhere: SQL[] = [
    eq(knowledgeChunksTable.workspaceId, activeWorkspaceId),
    ilike(knowledgeChunksTable.chunkText, pattern),
  ];

  if (baseId) {
    docWhere.push(eq(knowledgeDocumentsTable.knowledgeBaseId, baseId));
    faqWhere.push(eq(faqEntriesTable.knowledgeBaseId, baseId));
    chunkWhere.push(eq(knowledgeChunksTable.knowledgeBaseId, baseId));
  }

  const [documents, faqs, chunks] = await Promise.all([
    db.select({
      id: knowledgeDocumentsTable.id,
      title: knowledgeDocumentsTable.title,
      knowledgeBaseId: knowledgeDocumentsTable.knowledgeBaseId,
      status: knowledgeDocumentsTable.status,
    }).from(knowledgeDocumentsTable).where(and(...docWhere)).limit(10),
    db.select({
      id: faqEntriesTable.id,
      question: faqEntriesTable.question,
      answer: faqEntriesTable.answer,
      category: faqEntriesTable.category,
      knowledgeBaseId: faqEntriesTable.knowledgeBaseId,
    }).from(faqEntriesTable).where(and(...faqWhere)).limit(10),
    db.select({
      id: knowledgeChunksTable.id,
      chunkText: knowledgeChunksTable.chunkText,
      chunkIndex: knowledgeChunksTable.chunkIndex,
      documentId: knowledgeChunksTable.documentId,
      knowledgeBaseId: knowledgeChunksTable.knowledgeBaseId,
    }).from(knowledgeChunksTable).where(and(...chunkWhere)).limit(10),
  ]);

  res.json({
    query: q,
    results: {
      documents,
      faqs,
      chunks,
    },
    total: documents.length + faqs.length + chunks.length,
  });
});

// ─── Hard delete (حذف نهائي) ───────────────────────────────────────────────────
router.delete("/documents/:documentId", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const docId = String(req.params.documentId);
  const [existing] = await db.select().from(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الوثيقة غير موجودة", code: "NOT_FOUND" }); return; }
  // مقاطع الوثيقة تُحذف بالتعاقب (onDelete: cascade على document_id).
  await db.delete(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.id, docId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_document_delete",
    entityType: "knowledge_document", entityId: docId, entityLabel: existing.title,
  });
  res.json({ ok: true });
});

router.delete("/faqs/:faqId", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const faqId = String(req.params.faqId);
  const [existing] = await db.select().from(faqEntriesTable)
    .where(and(eq(faqEntriesTable.id, faqId), eq(faqEntriesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "السؤال غير موجود", code: "NOT_FOUND" }); return; }
  await db.delete(faqEntriesTable)
    .where(and(eq(faqEntriesTable.id, faqId), eq(faqEntriesTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "faq_delete",
    entityType: "faq_entry", entityId: faqId, entityLabel: existing.question,
  });
  res.json({ ok: true });
});

router.delete("/sources/:sourceId", requirePermission("knowledge:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const sourceId = String(req.params.sourceId);
  const [existing] = await db.select().from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "المصدر غير موجود", code: "NOT_FOUND" }); return; }
  // احذف وثائق المصدر أولاً (ومقاطعها بالتعاقب) لأن documents.source_id = set null لا cascade.
  await db.delete(knowledgeDocumentsTable)
    .where(and(eq(knowledgeDocumentsTable.sourceId, sourceId), eq(knowledgeDocumentsTable.workspaceId, activeWorkspaceId)));
  await db.delete(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.workspaceId, activeWorkspaceId)));
  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "knowledge_source_delete",
    entityType: "knowledge_source", entityId: sourceId, entityLabel: existing.title,
  });
  res.json({ ok: true });
});

export default router;
