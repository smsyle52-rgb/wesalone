import { db, pool } from "@workspace/db";
import {
  faqEntriesTable,
  knowledgeChunksTable,
  knowledgeDocumentsTable,
  knowledgeSourcesTable,
} from "@workspace/db";
import { and, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { cosineSimilarity, embed } from "./embeddings";
import { logger } from "../lib/logger";

// Minimum cosine similarity for a chunk to count as a semantic match in the pgvector pass.
// Tunable in production without a redeploy via KNOWLEDGE_VECTOR_MIN.
// خفض من 0.55 إلى 0.40 (5 يوليو): text-embedding-005 بوضع الاسترجاع اللامتماثل يعطي تطابقات
// عربية مُعاد صياغتها صحيحة في المدى 0.4–0.6، فكانت 0.55 تُسقطها صامتةً (سبب «يتجاهل المعرفة»).
const VECTOR_GATHER_MIN = Number(process.env.KNOWLEDGE_VECTOR_MIN ?? "0.4");

export type KnowledgeSearchItem = {
  type: "faq" | "document" | "chunk";
  id: string;
  title: string;
  content: string;
  knowledgeBaseId: string;
  documentId?: string | null;
  sourceUrl?: string | null;
  // تاريخ آخر تحديث للمصدر — يُحقن مع كل مصدر في برومبت الوكيل ليحسم تعارض النسخ المكررة
  // («الأحدث تحديثاً يغلب») — حادثة «القديم/الجديد» 11 يوليو: FAQ قديم كان يغلب وثيقة معدّلة.
  updatedAt?: Date | null;
  score: number;
  vectorScore: number;
  lexicalScore: number;
};

export type KnowledgeSearchParams = {
  workspaceId: string;
  query: string;
  knowledgeBaseIds?: string[];
  limit?: number;
};

export type KnowledgeAiSource = Pick<KnowledgeSearchItem, "type" | "id" | "title" | "content"> & {
  sourceUrl?: string | null;
  score?: number;
  updatedAt?: Date | null;
};

// ضمائر متصلة شائعة في أسئلة العملاء («دوامكم/أسعاركم/فروعكم») تجعل الكلمة لا تطابق نصياً
// جذرها في المعرفة («دوام/أسعار/فروع»). الطبقة الدلالية (pgvector) تلتقط ذلك عادةً، لكن الطبقة
// النصية يجب أن تصمد وحدها عند تعثّر الـembeddings — جولة «المستخدم الحي» 11 يوليو أظهرت سؤالاً
// بصيغة «دوامكم» يمرّ بلا أي مصدر عبر المسار النصي. نضيف المتغيّر المجرّد بجانب الأصل، لا بدله.
const ARABIC_ATTACHED_PRONOUN = /(كم|كن|هم|هن|ها|نا|ك|ه|ي)$/;

export function wordsForQuery(query: string): string[] {
  const words = query
    .split(/\s+/)
    .map((word) => word.trim().replace(/[?؟،,.;:!]/g, ""))
    .filter((word) => word.length > 2)
    .slice(0, 8);
  const withStems = new Set<string>(words);
  for (const word of words) {
    const stem = word.replace(ARABIC_ATTACHED_PRONOUN, "");
    if (stem.length > 2 && stem !== word) withStems.add(stem);
  }
  return [...withStems];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[?؟،,.;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lexicalScore(title: string, content: string, query: string, words: string[], base = 0): number {
  const titleText = normalize(title);
  const contentText = normalize(content);
  const queryText = normalize(query);
  let score = base;

  if (queryText && titleText.includes(queryText)) score += 30;
  if (queryText && contentText.includes(queryText)) score += 20;

  for (const word of words) {
    const normalizedWord = normalize(word);
    if (!normalizedWord) continue;
    if (titleText.includes(normalizedWord)) score += 6;
    if (contentText.includes(normalizedWord)) score += 2;
  }

  return score;
}

async function searchTsvChunks(params: Required<Pick<KnowledgeSearchParams, "workspaceId" | "query" | "limit">> & {
  knowledgeBaseIds: string[];
}): Promise<KnowledgeSearchItem[]> {
  const queryParams: unknown[] = [params.workspaceId, params.query, params.limit * 2];
  let kbClause = "";
  if (params.knowledgeBaseIds.length > 0) {
    queryParams.push(params.knowledgeBaseIds);
    kbClause = `AND kc.knowledge_base_id = ANY($${queryParams.length}::uuid[])`;
  }

  try {
    const result = await pool.query<{
      id: string;
      chunk_text: string;
      chunk_index: number;
      document_id: string;
      knowledge_base_id: string;
      document_title: string;
      source_url: string | null;
      doc_updated_at: Date | string | null;
      rank: string | number;
    }>(
      `
      SELECT
        kc.id,
        kc.chunk_text,
        kc.chunk_index,
        kc.document_id,
        kc.knowledge_base_id,
        kd.title AS document_title,
        kd.updated_at AS doc_updated_at,
        ks.source_url,
        ts_rank_cd(kc.tsv, plainto_tsquery('simple', $2)) AS rank
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      LEFT JOIN knowledge_sources ks ON ks.id = kd.source_id
      WHERE kc.workspace_id = $1
        ${kbClause}
        AND kd.status <> 'archived'
        AND kc.tsv @@ plainto_tsquery('simple', $2)
      ORDER BY rank DESC
      LIMIT $3
      `,
      queryParams
    );

    return result.rows.map((row) => ({
      type: "chunk" as const,
      id: row.id,
      title: `${row.document_title} #${row.chunk_index + 1}`,
      content: row.chunk_text,
      knowledgeBaseId: row.knowledge_base_id,
      documentId: row.document_id,
      sourceUrl: row.source_url,
      updatedAt: row.doc_updated_at ? new Date(row.doc_updated_at) : null,
      lexicalScore: Number(row.rank) * 100,
      vectorScore: 0,
      score: Number(row.rank) * 100,
    }));
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "tsvector knowledge search unavailable; using lexical fallback");
    return [];
  }
}

// True semantic search over stored chunk embeddings (pgvector `<=>` cosine distance, accelerated
// by the ivfflat index). This is the recall mechanism that finds the right chunk even when the
// customer's wording shares no words with the knowledge (e.g. "ايش خدمتكم" → "خدماتنا").
// Defensive: if the pgvector extension/column/embeddings are absent, returns [] and the caller
// falls back to lexical+tsv — same behaviour as before this feature.
async function searchVectorChunks(params: {
  workspaceId: string;
  queryVector: number[];
  knowledgeBaseIds: string[];
  limit: number;
}): Promise<KnowledgeSearchItem[]> {
  if (params.queryVector.length === 0) return [];
  const vectorLiteral = `[${params.queryVector.join(",")}]`;
  const queryParams: unknown[] = [vectorLiteral, params.workspaceId, params.limit * 3];
  let kbClause = "";
  if (params.knowledgeBaseIds.length > 0) {
    queryParams.push(params.knowledgeBaseIds);
    kbClause = `AND kc.knowledge_base_id = ANY($${queryParams.length}::uuid[])`;
  }

  try {
    const result = await pool.query<{
      id: string;
      chunk_text: string;
      chunk_index: number;
      document_id: string;
      knowledge_base_id: string;
      document_title: string;
      source_url: string | null;
      doc_updated_at: Date | string | null;
      score: string | number;
    }>(
      `
      SELECT
        kc.id,
        kc.chunk_text,
        kc.chunk_index,
        kc.document_id,
        kc.knowledge_base_id,
        kd.title AS document_title,
        kd.updated_at AS doc_updated_at,
        ks.source_url,
        1 - (kc.embedding <=> $1::vector) AS score
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      LEFT JOIN knowledge_sources ks ON ks.id = kd.source_id
      WHERE kc.workspace_id = $2
        AND kc.embedding IS NOT NULL
        AND kd.status <> 'archived'
        ${kbClause}
      ORDER BY kc.embedding <=> $1::vector
      LIMIT $3
      `,
      queryParams
    );

    return result.rows
      .map((row) => {
        const vectorScore = Number(row.score);
        return {
          type: "chunk" as const,
          id: row.id,
          title: `${row.document_title} #${row.chunk_index + 1}`,
          content: row.chunk_text,
          knowledgeBaseId: row.knowledge_base_id,
          documentId: row.document_id,
          sourceUrl: row.source_url,
      updatedAt: row.doc_updated_at ? new Date(row.doc_updated_at) : null,
          lexicalScore: 0,
          vectorScore,
          score: vectorScore,
        };
      })
      .filter((row) => row.vectorScore >= VECTOR_GATHER_MIN);
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      "pgvector knowledge search unavailable; using lexical+tsv fallback"
    );
    return [];
  }
}

export async function searchKnowledge(params: KnowledgeSearchParams): Promise<KnowledgeSearchItem[]> {
  const query = params.query.trim();
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
  const knowledgeBaseIds = [...new Set(params.knowledgeBaseIds?.filter(Boolean) ?? [])];
  if (query.length < 2) return [];

  // Launch fix (2 Jul): a query with no 3+-char words (short follow-ups like "كم؟")
  // used to abort retrieval entirely. The ilike lanes below do need words, but the
  // tsv and vector lanes work fine on the raw query — keep them running.
  const words = wordsForQuery(query);
  const hasWords = words.length > 0;

  const queryVector = await embed(query, "RETRIEVAL_QUERY");
  const [tsvChunks, vectorChunks] = await Promise.all([
    searchTsvChunks({ workspaceId: params.workspaceId, query, limit, knowledgeBaseIds }),
    searchVectorChunks({ workspaceId: params.workspaceId, queryVector, limit, knowledgeBaseIds }),
  ]);

  const faqFilters = [
    eq(faqEntriesTable.workspaceId, params.workspaceId),
    eq(faqEntriesTable.status, "active"),
    or(...words.flatMap((word) => [
      ilike(faqEntriesTable.question, `%${word}%`),
      ilike(faqEntriesTable.answer, `%${word}%`),
    ]))!,
  ];
  if (knowledgeBaseIds.length > 0) faqFilters.splice(1, 0, inArray(faqEntriesTable.knowledgeBaseId, knowledgeBaseIds));

  const docFilters = [
    eq(knowledgeDocumentsTable.workspaceId, params.workspaceId),
    ne(knowledgeDocumentsTable.status, "archived"),
    or(...words.flatMap((word) => [
      ilike(knowledgeDocumentsTable.title, `%${word}%`),
      ilike(knowledgeDocumentsTable.contentText, `%${word}%`),
    ]))!,
  ];
  if (knowledgeBaseIds.length > 0) docFilters.splice(1, 0, inArray(knowledgeDocumentsTable.knowledgeBaseId, knowledgeBaseIds));

  const chunkFilters = [
    eq(knowledgeChunksTable.workspaceId, params.workspaceId),
    ne(knowledgeDocumentsTable.status, "archived"),
    or(...words.map((word) => ilike(knowledgeChunksTable.chunkText, `%${word}%`)))!,
  ];
  if (knowledgeBaseIds.length > 0) chunkFilters.splice(1, 0, inArray(knowledgeChunksTable.knowledgeBaseId, knowledgeBaseIds));

  const [faqs, docs, chunks] = hasWords ? await Promise.all([
    db
      .select({
        id: faqEntriesTable.id,
        question: faqEntriesTable.question,
        answer: faqEntriesTable.answer,
        knowledgeBaseId: faqEntriesTable.knowledgeBaseId,
        updatedAt: faqEntriesTable.updatedAt,
      })
      .from(faqEntriesTable)
      .where(and(...faqFilters))
      .limit(limit * 2),
    db
      .select({
        id: knowledgeDocumentsTable.id,
        title: knowledgeDocumentsTable.title,
        contentText: knowledgeDocumentsTable.contentText,
        knowledgeBaseId: knowledgeDocumentsTable.knowledgeBaseId,
        sourceUrl: knowledgeSourcesTable.sourceUrl,
        updatedAt: knowledgeDocumentsTable.updatedAt,
      })
      .from(knowledgeDocumentsTable)
      .leftJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, knowledgeDocumentsTable.sourceId))
      .where(and(...docFilters))
      .limit(limit),
    db
      .select({
        id: knowledgeChunksTable.id,
        chunkText: knowledgeChunksTable.chunkText,
        chunkIndex: knowledgeChunksTable.chunkIndex,
        documentId: knowledgeChunksTable.documentId,
        knowledgeBaseId: knowledgeChunksTable.knowledgeBaseId,
        documentTitle: knowledgeDocumentsTable.title,
        sourceUrl: knowledgeSourcesTable.sourceUrl,
        docUpdatedAt: knowledgeDocumentsTable.updatedAt,
      })
      .from(knowledgeChunksTable)
      .innerJoin(knowledgeDocumentsTable, eq(knowledgeDocumentsTable.id, knowledgeChunksTable.documentId))
      .leftJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, knowledgeDocumentsTable.sourceId))
      .where(and(...chunkFilters))
      .limit(limit * 2),
  ]) : [[], [], []];

  const candidates: KnowledgeSearchItem[] = [
    ...vectorChunks,
    ...tsvChunks,
    ...faqs.map((faq) => ({
      type: "faq" as const,
      id: faq.id,
      title: faq.question,
      content: `سؤال: ${faq.question}\nإجابة: ${faq.answer}`,
      knowledgeBaseId: faq.knowledgeBaseId,
      updatedAt: faq.updatedAt,
      lexicalScore: lexicalScore(faq.question, faq.answer, query, words, 12),
      vectorScore: 0,
      score: 0,
    })),
    ...docs.map((doc) => ({
      type: "document" as const,
      id: doc.id,
      title: doc.title,
      content: doc.contentText.slice(0, 1600),
      knowledgeBaseId: doc.knowledgeBaseId,
      documentId: doc.id,
      sourceUrl: doc.sourceUrl,
      updatedAt: doc.updatedAt,
      lexicalScore: lexicalScore(doc.title, doc.contentText, query, words, 3),
      vectorScore: 0,
      score: 0,
    })),
    ...chunks.map((chunk) => ({
      type: "chunk" as const,
      id: chunk.id,
      title: `${chunk.documentTitle} #${chunk.chunkIndex + 1}`,
      content: chunk.chunkText,
      knowledgeBaseId: chunk.knowledgeBaseId,
      documentId: chunk.documentId,
      sourceUrl: chunk.sourceUrl,
      updatedAt: chunk.docUpdatedAt,
      lexicalScore: lexicalScore(chunk.documentTitle, chunk.chunkText, query, words, 5),
      vectorScore: 0,
      score: 0,
    })),
  ];

  const seen = new Map<string, KnowledgeSearchItem>();
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.id}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...candidate });
      continue;
    }
    // Same item surfaced by more than one pass (semantic + lexical/tsv): keep the strongest of each signal.
    existing.lexicalScore = Math.max(existing.lexicalScore, candidate.lexicalScore);
    existing.vectorScore = Math.max(existing.vectorScore, candidate.vectorScore);
    if (!existing.sourceUrl && candidate.sourceUrl) existing.sourceUrl = candidate.sourceUrl;
    if (!existing.updatedAt && candidate.updatedAt) existing.updatedAt = candidate.updatedAt;
  }

  const ranked = await Promise.all([...seen.values()].map(async (item) => {
    // Reuse the stored-vector similarity from the semantic pass; only re-embed live for items that
    // arrived via lexical/tsv (faqs/documents) and have no vector score yet.
    const vectorScore = item.vectorScore > 0
      ? item.vectorScore
      : cosineSimilarity(queryVector, await embed(`${item.title}\n${item.content.slice(0, 2000)}`));
    const normalizedLexical = Math.min(item.lexicalScore / 50, 1);
    return {
      ...item,
      vectorScore,
      score: (0.6 * Math.max(vectorScore, 0)) + (0.4 * normalizedLexical),
    };
  }));

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function searchKnowledgeForAi(params: KnowledgeSearchParams): Promise<KnowledgeAiSource[]> {
  const results = await searchKnowledge(params);
  return results.map((result) => ({
    type: result.type,
    id: result.id,
    title: result.title,
    content: result.content,
    sourceUrl: result.sourceUrl,
    score: result.score,
    updatedAt: result.updatedAt ?? null,
  }));
}
