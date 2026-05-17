import { db, knowledgeDocumentsTable } from "../lib/db/src/index";
import { rebuildDocumentChunks } from "../artifacts/api-server/src/services/kb-chunker";

async function main(): Promise<void> {
  const docs = await db.select().from(knowledgeDocumentsTable);
  let rebuilt = 0;
  let chunks = 0;

  for (const doc of docs) {
    const result = await rebuildDocumentChunks({
      documentId: doc.id,
      workspaceId: doc.workspaceId,
      knowledgeBaseId: doc.knowledgeBaseId,
      contentText: doc.contentText,
    });
    rebuilt += 1;
    chunks += result.chunkCount;
    console.log(`rebuilt ${doc.id}: ${result.chunkCount} chunks`);
  }

  console.log(`KB_BACKFILL_DONE documents=${rebuilt} chunks=${chunks}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
