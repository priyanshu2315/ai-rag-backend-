-- DropIndex
DROP INDEX "child_chunk_document_id_idx";

-- DropIndex
DROP INDEX "child_chunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetOtp" TEXT,
ADD COLUMN     "resetOtpExpiresAt" TIMESTAMP(3);
