-- CreateTable
CREATE TABLE "authenticator_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "customerId" TEXT,
    "secretEncrypted" TEXT,
    "pendingSecretEncrypted" TEXT,
    "enabledAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authenticator_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authenticator_credentials_userId_key" ON "authenticator_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "authenticator_credentials_customerId_key" ON "authenticator_credentials"("customerId");

-- AddForeignKey
ALTER TABLE "authenticator_credentials" ADD CONSTRAINT "authenticator_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authenticator_credentials" ADD CONSTRAINT "authenticator_credentials_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

