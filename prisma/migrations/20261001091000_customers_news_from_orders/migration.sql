-- Customer news comes from the last day's orders, not stored lines (Brandon, 1 Oct 2026).
DROP INDEX "Customer_newsAt_idx";
ALTER TABLE "Customer" DROP COLUMN "newsAt", DROP COLUMN "newsText";
CREATE INDEX "Customer_lastOrderAt_idx" ON "Customer"("lastOrderAt");
