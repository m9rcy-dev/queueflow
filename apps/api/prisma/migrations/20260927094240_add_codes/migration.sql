-- CreateEnum
CREATE TYPE "CodeContextType" AS ENUM ('QUEUE');

-- CreateTable
CREATE TABLE "codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "contextType" "CodeContextType" NOT NULL,
    "queueId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "codes_publicCode_key" ON "codes"("publicCode");

-- CreateIndex
CREATE INDEX "codes_tenantId_idx" ON "codes"("tenantId");

-- AddForeignKey
ALTER TABLE "codes" ADD CONSTRAINT "codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codes" ADD CONSTRAINT "codes_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
