-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROACHING', 'NEARLY_NEXT', 'CALLED', 'RECALLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'SENT');

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "approachingNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "calledNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "nearlyNextNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "approachingThreshold" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "nearlyNextThreshold" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_outbox_status_idx" ON "notification_outbox"("status");

-- CreateIndex
CREATE INDEX "notification_outbox_queueEntryId_idx" ON "notification_outbox"("queueEntryId");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
