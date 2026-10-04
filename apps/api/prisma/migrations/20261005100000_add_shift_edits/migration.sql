-- AlterTable
ALTER TABLE "staff_shifts" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

