-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppointmentCancellationReason" AS ENUM ('CUSTOMER_REQUESTED', 'BUSINESS_INITIATED', 'NO_AVAILABILITY', 'BUSINESS_CLOSURE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_BOOKED';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_CANCELLED';

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "appointmentCapacity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxAppointmentsPerDay" INTEGER;

-- AlterTable
ALTER TABLE "notification_outbox" ADD COLUMN     "appointmentId" TEXT,
ALTER COLUMN "queueEntryId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "appointmentAdvanceDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "appointmentBufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "appointmentCancelNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "appointmentMinLeadMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "appointmentSlotIntervalMinutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "location_closures" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMinutes" INTEGER,
    "endMinutes" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "occupiedUntil" TIMESTAMP(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "idempotencyKey" TEXT,
    "bookedByStaffId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" "AppointmentCancellationReason",
    "cancellationNote" TEXT,
    "cancelledByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_closures_locationId_date_idx" ON "location_closures"("locationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_publicToken_key" ON "appointments"("publicToken");

-- CreateIndex
CREATE INDEX "appointments_locationId_localDate_status_idx" ON "appointments"("locationId", "localDate", "status");

-- CreateIndex
CREATE INDEX "appointments_customerId_idx" ON "appointments"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenantId_idempotencyKey_key" ON "appointments"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_outbox_appointmentId_idx" ON "notification_outbox"("appointmentId");

-- AddForeignKey
ALTER TABLE "location_closures" ADD CONSTRAINT "location_closures_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bookedByStaffId_fkey" FOREIGN KEY ("bookedByStaffId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelledByStaffId_fkey" FOREIGN KEY ("cancelledByStaffId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
