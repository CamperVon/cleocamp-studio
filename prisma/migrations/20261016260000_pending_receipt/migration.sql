-- Stock receipts, counts and upward adjustments held for a person's yes (16 Oct 2026).
CREATE TABLE "PendingReceipt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turnId" TEXT NOT NULL,
    "personId" TEXT,
    "productVariantId" TEXT,
    "componentId" TEXT,
    "locationId" TEXT,
    "atVendorId" TEXT,
    "type" TEXT NOT NULL,
    "deltaQty" DECIMAL(12,3) NOT NULL,
    "poNumber" TEXT,
    "label" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedEventId" TEXT,
    CONSTRAINT "PendingReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PendingReceipt_turnId_idx" ON "PendingReceipt"("turnId");
