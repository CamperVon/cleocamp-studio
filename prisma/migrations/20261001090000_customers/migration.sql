-- Customers: repeat and big buyers, and notable people (Brandon, 30 Sept 2026).
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "lastOrderName" TEXT,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "notable" TEXT,
    "notableWho" TEXT,
    "notableSource" TEXT,
    "notableCheckedAt" TIMESTAMP(3),
    "notableDismissedAt" TIMESTAMP(3),
    "newsText" TEXT,
    "newsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Customer_shopifyCustomerId_key" ON "Customer"("shopifyCustomerId");
CREATE INDEX "Customer_orderCount_idx" ON "Customer"("orderCount");
CREATE INDEX "Customer_totalSpentCents_idx" ON "Customer"("totalSpentCents");
CREATE INDEX "Customer_notable_idx" ON "Customer"("notable");
CREATE INDEX "Customer_newsAt_idx" ON "Customer"("newsAt");
