-- AlterTable
ALTER TABLE "device_trusts" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "tenant_invites" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "tenant_users" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tenant_logos" (
    "tenantId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_logos_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_trusts" ADD CONSTRAINT "device_trusts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invites" ADD CONSTRAINT "tenant_invites_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_logos" ADD CONSTRAINT "tenant_logos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (Phase 16): existing MANAGER/STAFF members get their business's
-- first location, so nobody loses access on deploy. A business with no
-- location yet leaves them unassigned; they see nothing location-scoped
-- until an owner/admin assigns them.
UPDATE "tenant_users" tu
SET "locationId" = (
  SELECT l.id FROM "locations" l
  WHERE l."tenantId" = tu."tenantId"
  ORDER BY l."createdAt" ASC
  LIMIT 1
)
WHERE tu.role IN ('MANAGER', 'STAFF') AND tu."locationId" IS NULL;

-- Same for pending invites.
UPDATE "tenant_invites" ti
SET "locationId" = (
  SELECT l.id FROM "locations" l
  WHERE l."tenantId" = ti."tenantId"
  ORDER BY l."createdAt" ASC
  LIMIT 1
)
WHERE ti.role IN ('MANAGER', 'STAFF') AND ti."locationId" IS NULL
  AND ti."acceptedAt" IS NULL AND ti."revokedAt" IS NULL;
