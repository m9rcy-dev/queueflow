-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'CANCELLED', 'SKIPPED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "maxActiveTicketsPerCustomer" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "firstName" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'ACTIVE',
    "servingCapacity" INTEGER NOT NULL DEFAULT 1,
    "maxActiveTicketsPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "maxRecallCount" INTEGER NOT NULL DEFAULT 2,
    "recallGracePeriodMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_services" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "queue_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_ticket_counters" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "queue_ticket_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "customerId" TEXT,
    "assignedStaffId" TEXT,
    "publicToken" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "serviceDate" DATE NOT NULL,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'WAITING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "recallCount" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_phoneE164_key" ON "customers"("tenantId", "phoneE164");

-- CreateIndex
CREATE INDEX "queues_tenantId_idx" ON "queues"("tenantId");

-- CreateIndex
CREATE INDEX "queues_locationId_idx" ON "queues"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_services_queueId_serviceId_key" ON "queue_services"("queueId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_ticket_counters_queueId_serviceDate_key" ON "queue_ticket_counters"("queueId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_publicToken_key" ON "queue_entries"("publicToken");

-- CreateIndex
CREATE INDEX "queue_entries_queueId_status_idx" ON "queue_entries"("queueId", "status");

-- CreateIndex
CREATE INDEX "queue_entries_customerId_idx" ON "queue_entries"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_tenantId_idempotencyKey_key" ON "queue_entries"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_queueId_serviceDate_ticketNumber_key" ON "queue_entries"("queueId", "serviceDate", "ticketNumber");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_services" ADD CONSTRAINT "queue_services_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_services" ADD CONSTRAINT "queue_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_ticket_counters" ADD CONSTRAINT "queue_ticket_counters_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
