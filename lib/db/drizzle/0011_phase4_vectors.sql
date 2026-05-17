DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension is unavailable; lexical fallback will be used';
END $$;

ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "tsv" tsvector;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embedding_model" text;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embedded_at" timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
  END IF;
END $$;

UPDATE "knowledge_chunks"
SET "tsv" = to_tsvector('simple', coalesce("chunk_text", ''))
WHERE "tsv" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_chunks_tsv" ON "knowledge_chunks" USING gin ("tsv");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'knowledge_chunks' AND column_name = 'embedding'
     ) THEN
    CREATE INDEX IF NOT EXISTS "idx_chunks_embedding" ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION knowledge_chunks_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('simple', coalesce(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_chunks_tsv_update ON "knowledge_chunks";
CREATE TRIGGER trg_knowledge_chunks_tsv_update
BEFORE INSERT OR UPDATE OF "chunk_text" ON "knowledge_chunks"
FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_tsv_update();
