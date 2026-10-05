/*
  Warnings:

  - Added the required column `searchText` to the `ChildChunk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `searchText` to the `ParentChunk` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ChildChunk" ADD COLUMN     "searchText" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ParentChunk" ADD COLUMN     "nextParentId" TEXT,
ADD COLUMN     "prevParentId" TEXT,
ADD COLUMN     "searchText" TEXT NOT NULL;



CREATE INDEX "child_chunk_search_text_gin_idx"
ON "ChildChunk"
USING GIN (to_tsvector('english', "searchText"));