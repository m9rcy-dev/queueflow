-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PREFERRED_STAFF_UNAVAILABLE';

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "preferredStaffId" TEXT;

-- AlterTable
ALTER TABLE "tenant_users" ADD COLUMN     "publicName" TEXT;

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tenantUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_shifts_tenantId_idx" ON "staff_shifts"("tenantId");

-- CreateIndex
CREATE INDEX "staff_shifts_locationId_endedAt_idx" ON "staff_shifts"("locationId", "endedAt");

-- CreateIndex
CREATE INDEX "staff_shifts_tenantUserId_startedAt_idx" ON "staff_shifts"("tenantUserId", "startedAt");

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_preferredStaffId_fkey" FOREIGN KEY ("preferredStaffId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one open shift per member (ADR-017): clocking in twice can't
-- leave two "on the floor" rows. Partial index — Prisma can't express it.
CREATE UNIQUE INDEX "staff_shifts_one_open_per_member"
  ON "staff_shifts" ("tenantUserId") WHERE "endedAt" IS NULL;
