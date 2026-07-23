// Step 6: old `knowledge_documents` + `knowledge_chunks` -> new `AIFile` +
// `AIEmbedding` — TEXT CONTENT ONLY, per the migration plan. OLD embeddings
// are pgvector(768); NEW's AIEmbedding column is vector(1536) — a hard
// dimension mismatch, vectors literally cannot be copied into that column.
// Every migrated chunk lands with `embedding: null, status: "pending"`; a
// separate re-embedding pass (via the new system's own embedding pipeline,
// not this script) is required before knowledge search works again.
//
// NEW's AIFile requires path/size/mimeType as if a real file were uploaded.
// Many old knowledge documents originate from pasted text (no real file), so
// this step synthesizes a placeholder path/mimeType — no bytes are actually
// written to storage at that path. This is a migration artifact, not a real
// stored file; the `legacy-import/` path prefix makes that visible.

import { db } from "../../../src/client"
import { aiEmbeddingModel, aiFileModel } from "../../../src/schema"
import { getOrCreateId } from "../id-map"
import { fetchOldKnowledgeChunks, fetchOldKnowledgeDocuments } from "../old-db"
import type { WorkspaceMigrationResult } from "./01-workspaces"

export const migrateKnowledge = async (
  workspaces: WorkspaceMigrationResult[],
) => {
  const newWorkspaceIdByOld = new Map(
    workspaces.map((w) => [w.oldWorkspaceId, w.newWorkspaceId]),
  )

  const documents = await fetchOldKnowledgeDocuments()
  let filesMigrated = 0
  let chunksMigrated = 0

  for (const document of documents) {
    const newWorkspaceId = newWorkspaceIdByOld.get(document.workspaceId)
    if (!newWorkspaceId) {
      continue
    }

    const newFileId = getOrCreateId("aiFile", document.id)
    await db
      .insert(aiFileModel)
      .values({
        id: newFileId,
        workspaceId: newWorkspaceId,
        name: document.title,
        path: `legacy-import/${document.workspaceId}/${document.id}.txt`,
        mimeType: "text/plain",
        size: Buffer.byteLength(document.contentText, "utf8"),
      })
      .onConflictDoNothing({ target: aiFileModel.id })
    filesMigrated += 1

    const chunks = await fetchOldKnowledgeChunks(document.id)
    // A document with zero chunks (never processed by the old chunker) still
    // gets its AIFile row above — nothing to embed, but the raw text/name is
    // preserved and re-chunkable later. Fall back to the whole document text
    // as a single "chunk" so nothing is silently dropped.
    const chunkTexts =
      chunks.length > 0
        ? chunks.map((c) => c.chunkText)
        : [document.contentText]

    for (const [index, chunkText] of chunkTexts.entries()) {
      await db
        .insert(aiEmbeddingModel)
        .values({
          // Deterministic id (doc id + chunk position) so a re-run dedups
          // instead of duplicating every chunk.
          id: getOrCreateId("aiEmbedding", `${document.id}:${index}`),
          workspaceId: newWorkspaceId,
          aiFileId: newFileId,
          content: chunkText,
          status: "pending",
        })
        .onConflictDoNothing({ target: aiEmbeddingModel.id })
      chunksMigrated += 1
    }
  }

  console.log(
    `Step 6: migrated ${filesMigrated}/${documents.length} knowledge document(s), ${chunksMigrated} chunk(s) (all pending re-embedding).`,
  )
}
