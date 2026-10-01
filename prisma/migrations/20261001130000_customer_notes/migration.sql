-- Customers by hand, with notes (Brandon, 1 Oct 2026).
ALTER TABLE "Customer" ALTER COLUMN "shopifyCustomerId" DROP NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "shopifyUpdatedAt" DROP NOT NULL;
ALTER TABLE "Customer" ADD COLUMN "notes" TEXT;
ALTER TABLE "Customer" ADD COLUMN "pinnedAt" TIMESTAMP(3);
CREATE INDEX "Customer_pinnedAt_idx" ON "Customer"("pinnedAt");
