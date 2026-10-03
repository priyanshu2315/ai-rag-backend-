-- AlterTable
ALTER TABLE "Document" ADD COLUMN "summaryStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- Existing documents that finished under the previous single-status workflow.
UPDATE "Document"
SET "summaryStatus" = CASE
  WHEN NULLIF(BTRIM("summary"), '') IS NOT NULL THEN 'COMPLETED'
  ELSE 'FAILED'
END
WHERE "status" = 'COMPLETED';
