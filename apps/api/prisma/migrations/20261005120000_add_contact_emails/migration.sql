-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'JOINED';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "contactEmail" TEXT;

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "contactEmail" TEXT;

