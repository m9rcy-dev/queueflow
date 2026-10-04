-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AppointmentStatus" ADD VALUE 'CHECKED_IN';
ALTER TYPE "AppointmentStatus" ADD VALUE 'NO_SHOW';

-- AlterEnum
ALTER TYPE "CodeContextType" ADD VALUE 'APPOINTMENT_TICKET';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_REMINDER';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "noShowAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "codes" ADD COLUMN     "appointmentId" TEXT;

-- AlterTable
ALTER TABLE "notification_outbox" ADD COLUMN     "reminderOffsetMinutes" INTEGER;

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "priorityFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "appointmentNoShowGraceMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "appointmentPriorityWindowMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "appointmentReminderOffsetsMinutes" INTEGER[] DEFAULT ARRAY[1440, 120]::INTEGER[];

-- CreateIndex
CREATE UNIQUE INDEX "codes_appointmentId_key" ON "codes"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_appointmentId_type_reminderOffsetMinute_key" ON "notification_outbox"("appointmentId", "type", "reminderOffsetMinutes");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_appointmentId_key" ON "queue_entries"("appointmentId");

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codes" ADD CONSTRAINT "codes_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

