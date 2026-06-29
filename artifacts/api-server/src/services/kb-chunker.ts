import { db, pool } from "@workspace/db";
import { knowledgeChunksTable } from "@workspace/db";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { embedWithMetadata } from "./embeddings";
import { logger } from "../lib/logger";

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

export function estimateKnowledgeTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitAtBoundary(text: string, start: number, maxEnd: number): number {
  if (maxEnd >= text.length) return text.length;
  const boundaryChars = ["\n\n", "\n", ".", "؟", "!", "،", " "];
  for (const boundary of boundaryChars) {
    const index = text.lastIndexOf(boundary, maxEnd);
    if (index > start + CHUNK_SIZE / 2) return index + boundary.length;
  }
  return maxEnd;
}

export function chunkKnowledgeText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = splitAtBoundary(normalized, start, Math.min(start + CHUNK_SIZE, normalized.length));
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }

  return chunks;
}

export async function rebuildDocumentChunks(params: {
  documentId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  contentText: string;
}): Promise<{ chunkCount: number }> {
  await db
    .delete(knowledgeChunksTable)
    .where(and(
      eq(knowledgeChunksTable.documentId, params.documentId),
      eq(knowledgeChunksTable.workspaceId, params.workspaceId)
    ));

  const chunks = chunkKnowledgeText(params.contentText);
  if (chunks.length === 0) return { chunkCount: 0 };

  const prepared = await Promise.all(chunks.map(async (chunkText, chunkIndex) => {
    // Documents are embedded with the RETRIEVAL_DOCUMENT task type (the embed() default);
    // queries use RETRIEVAL_QUERY in knowledge-retrieval.ts for correct asymmetric search.
    const embedding = await embedWithMetadata(chunkText);
    const isReal = embedding.provider === "vertex";
    return {
      vector: isReal ? embedding.vector : null,
      row: {
        workspaceId: params.workspaceId,
        knowledgeBaseId: params.knowledgeBaseId,
        documentId: params.documentId,
        chunkIndex,
        chunkText,
        tokenEstimate: estimateKnowledgeTokens(chunkText),
        embeddingStatus: isReal ? "embedded" : "skipped",
        embeddingRef: `sha256:${createHash("sha256").update(chunkText).digest("hex")}`,
        embeddingModel: embedding.model,
        embeddedAt: new Date(),
        metadata: {
          embeddingProvider: embedding.provider,
          vectorLength: embedding.vector.length,
        },
      },
    };
  }));

  const inserted = await db
    .insert(knowledgeChunksTable)
    .values(prepared.map((p) => p.row))
    .returning({ id: knowledgeChunksTable.id });

  // Persist the embedding vector into the existing pgvector column so retrieval can do true
  // semantic search (the migration already provisions `embedding vector(768)` + ivfflat index).
  // Defensive: the Drizzle schema does not model this column, so we write it via raw SQL — and if
  // the pgvector extension/column is unavailable the chunks are still inserted and search falls
  // back to lexical+tsv. No schema-drift risk, no broken ingestion.
  try {
    await Promise.all(
      inserted.map((chunk, index) => {
        const vector = prepared[index]?.vector;
        if (!vector || vector.length === 0) return null;
        return pool.query(
          "UPDATE knowledge_chunks SET embedding = $1::vector WHERE id = $2 AND workspace_id = $3",
          [`[${vector.join(",")}]`, chunk.id, params.workspaceId]
        );
      })
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), documentId: params.documentId },
      "pgvector embedding store skipped (extension/column unavailable); lexical+tsv search remains active"
    );
  }

  return { chunkCount: prepared.length };
}
