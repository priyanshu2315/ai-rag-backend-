-- AlterTable
ALTER TABLE "ChildChunk" ADD COLUMN     "addedInVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "removedInVersion" INTEGER;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ParentChunk" ADD COLUMN     "addedInVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "removedInVersion" INTEGER;

-- CreateTable
CREATE TABLE "DocumentUnit" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "parentChunkId" TEXT,

    CONSTRAINT "DocumentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentUnit_documentId_position_key" ON "DocumentUnit"("documentId", "position");

-- AddForeignKey
ALTER TABLE "DocumentUnit" ADD CONSTRAINT "DocumentUnit_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUnit" ADD CONSTRAINT "DocumentUnit_parentChunkId_fkey" FOREIGN KEY ("parentChunkId") REFERENCES "ParentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
