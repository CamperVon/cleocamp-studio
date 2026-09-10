CREATE TABLE "PurchaseOrderExport" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseOrderExport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseOrderExport_purchaseOrderId_contentHash_key"
    ON "PurchaseOrderExport"("purchaseOrderId", "contentHash");
CREATE INDEX "PurchaseOrderExport_purchaseOrderId_createdAt_idx"
    ON "PurchaseOrderExport"("purchaseOrderId", "createdAt");
ALTER TABLE "PurchaseOrderExport" ADD CONSTRAINT "PurchaseOrderExport_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD COLUMN "agentUsageJson" JSONB;
