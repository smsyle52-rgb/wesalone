import { db } from "@workspace/db";
import { knowledgeChunksTable } from "@workspace/db";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { embedWithMetadata } from "./embeddings";

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

  const values = await Promise.all(chunks.map(async (chunkText, chunkIndex) => {
    const embedding = await embedWithMetadata(chunkText);
    return {
      workspaceId: params.workspaceId,
      knowledgeBaseId: params.knowledgeBaseId,
      documentId: params.documentId,
      chunkIndex,
      chunkText,
      tokenEstimate: estimateKnowledgeTokens(chunkText),
      embeddingStatus: "embedded",
      embeddingRef: `sha256:${createHash("sha256").update(chunkText).digest("hex")}`,
      embeddingModel: embedding.model,
      embeddedAt: new Date(),
      metadata: {
        embeddingProvider: embedding.provider,
        vectorLength: embedding.vector.length,
      },
    };
  }));

  await db.insert(knowledgeChunksTable).values(values);
  return { chunkCount: values.length };
}
