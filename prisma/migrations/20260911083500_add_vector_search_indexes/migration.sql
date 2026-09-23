-- Fix embedding column to a fixed dimension (required by the HNSW builder)
-- Safe: table is empty. Xenova/all-MiniLM-L6-v2 outputs 384-dim vectors.
ALTER TABLE "ChildChunk" ALTER COLUMN "embedding" TYPE vector(384);

-- HNSW index for approximate nearest-neighbour cosine similarity search
CREATE INDEX IF NOT EXISTS "child_chunk_embedding_hnsw_idx"
ON "ChildChunk"
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- B-Tree index for document-scoped lookups (foreign key)
CREATE INDEX IF NOT EXISTS "child_chunk_document_id_idx"
ON "ChildChunk" ("documentId");

-- Expression index for deterministic page-number routing
CREATE INDEX IF NOT EXISTS "child_chunk_doc_page_idx"
ON "ChildChunk" ("documentId", ((metadata->>'page_number')::text));
