DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'knowledge_chunks'
         AND column_name = 'embedding'
     ) THEN
    DROP INDEX IF EXISTS "idx_chunks_embedding";
    ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(768) USING NULL;
    CREATE INDEX IF NOT EXISTS "idx_chunks_embedding" ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops);
  END IF;
END $$;
