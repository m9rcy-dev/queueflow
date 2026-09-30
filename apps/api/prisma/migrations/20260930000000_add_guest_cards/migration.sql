-- AlterEnum
ALTER TYPE "CodeContextType" ADD VALUE 'GUEST_CARD';

-- AlterTable
ALTER TABLE "codes" ADD COLUMN     "currentEntryId" TEXT,
ADD COLUMN     "guestNumber" INTEGER,
ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "codes_currentEntryId_key" ON "codes"("currentEntryId");

-- CreateIndex
CREATE INDEX "codes_locationId_idx" ON "codes"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "codes_locationId_guestNumber_key" ON "codes"("locationId", "guestNumber");

-- AddForeignKey
ALTER TABLE "codes" ADD CONSTRAINT "codes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codes" ADD CONSTRAINT "codes_currentEntryId_fkey" FOREIGN KEY ("currentEntryId") REFERENCES "queue_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

