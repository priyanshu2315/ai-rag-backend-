-- CreateIndex
CREATE INDEX "ChildChunk_documentId_removedInVersion_idx" ON "ChildChunk"("documentId", "removedInVersion");

-- CreateIndex
CREATE INDEX "ParentChunk_documentId_removedInVersion_idx" ON "ParentChunk"("documentId", "removedInVersion");
