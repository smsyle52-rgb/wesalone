import { db, pool } from "@workspace/db";
import {
  faqEntriesTable,
  knowledgeChunksTable,
  knowledgeDocumentsTable,
  knowledgeSourcesTable,
} from "@workspace/db";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { cosineSimilarity, embed } from "./embeddings";
import { logger } from "../lib/logger";

export type KnowledgeSearchItem = {
  type: "faq" | "document" | "chunk";
  id: string;
  title: string;
  content: string;
  knowledgeBaseId: string;
  documentId?: string | null;
  sourceUrl?: string | null;
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
};

function wordsForQuery(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.trim().replace(/[?؟،,.;:!]/g, ""))
    .filter((word) => word.length > 2)
    .slice(0, 8);
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
        ks.source_url,
        ts_rank_cd(kc.tsv, plainto_tsquery('simple', $2)) AS rank
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc.document_id
      LEFT JOIN knowledge_sources ks ON ks.id = kd.source_id
      WHERE kc.workspace_id = $1
        ${kbClause}
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
      lexicalScore: Number(row.rank) * 100,
      vectorScore: 0,
      score: Number(row.rank) * 100,
    }));
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "tsvector knowledge search unavailable; using lexical fallback");
    return [];
  }
}

export async function searchKnowledge(params: KnowledgeSearchParams): Promise<KnowledgeSearchItem[]> {
  const query = params.query.trim();
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
  const knowledgeBaseIds = [...new Set(params.knowledgeBaseIds?.filter(Boolean) ?? [])];
  if (query.length < 2) return [];

  const words = wordsForQuery(query);
  if (words.length === 0) return [];

  const [queryVector, tsvChunks] = await Promise.all([
    embed(query),
    searchTsvChunks({ workspaceId: params.workspaceId, query, limit, knowledgeBaseIds }),
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
    or(...words.flatMap((word) => [
      ilike(knowledgeDocumentsTable.title, `%${word}%`),
      ilike(knowledgeDocumentsTable.contentText, `%${word}%`),
    ]))!,
  ];
  if (knowledgeBaseIds.length > 0) docFilters.splice(1, 0, inArray(knowledgeDocumentsTable.knowledgeBaseId, knowledgeBaseIds));

  const chunkFilters = [
    eq(knowledgeChunksTable.workspaceId, params.workspaceId),
    or(...words.map((word) => ilike(knowledgeChunksTable.chunkText, `%${word}%`)))!,
  ];
  if (knowledgeBaseIds.length > 0) chunkFilters.splice(1, 0, inArray(knowledgeChunksTable.knowledgeBaseId, knowledgeBaseIds));

  const [faqs, docs, chunks] = await Promise.all([
    db
      .select({
        id: faqEntriesTable.id,
        question: faqEntriesTable.question,
        answer: faqEntriesTable.answer,
        knowledgeBaseId: faqEntriesTable.knowledgeBaseId,
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
      })
      .from(knowledgeChunksTable)
      .innerJoin(knowledgeDocumentsTable, eq(knowledgeDocumentsTable.id, knowledgeChunksTable.documentId))
      .leftJoin(knowledgeSourcesTable, eq(knowledgeSourcesTable.id, knowledgeDocumentsTable.sourceId))
      .where(and(...chunkFilters))
      .limit(limit * 2),
  ]);

  const candidates: KnowledgeSearchItem[] = [
    ...tsvChunks,
    ...faqs.map((faq) => ({
      type: "faq" as const,
      id: faq.id,
      title: faq.question,
      content: `سؤال: ${faq.question}\nإجابة: ${faq.answer}`,
      knowledgeBaseId: faq.knowledgeBaseId,
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
      lexicalScore: lexicalScore(chunk.documentTitle, chunk.chunkText, query, words, 5),
      vectorScore: 0,
      score: 0,
    })),
  ];

  const seen = new Map<string, KnowledgeSearchItem>();
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.id}`;
    const existing = seen.get(key);
    if (!existing || candidate.lexicalScore > existing.lexicalScore) seen.set(key, candidate);
  }

  const ranked = await Promise.all([...seen.values()].map(async (item) => {
    const itemVector = await embed(`${item.title}\n${item.content.slice(0, 2000)}`);
    const vectorScore = cosineSimilarity(queryVector, itemVector);
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
  }));
}
