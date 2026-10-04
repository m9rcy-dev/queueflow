-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "servedByStaffId" TEXT;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_servedByStaffId_fkey" FOREIGN KEY ("servedByStaffId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: entries already started/completed before this column existed
-- were served by whoever called them — the best record there is.
UPDATE "queue_entries"
SET "servedByStaffId" = "assignedStaffId"
WHERE "servedByStaffId" IS NULL AND "startedAt" IS NOT NULL AND "assignedStaffId" IS NOT NULL;
