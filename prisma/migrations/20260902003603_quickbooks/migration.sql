-- CreateTable
CREATE TABLE "QuickBooksConnection" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSnapshot" (
    "id" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "cashCents" BIGINT,
    "arCents" BIGINT,
    "apCents" BIGINT,
    "revenueMtdCents" BIGINT,
    "revenueYtdCents" BIGINT,
    "expensesMtdCents" BIGINT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSnapshot_forDate_key" ON "FinancialSnapshot"("forDate");
