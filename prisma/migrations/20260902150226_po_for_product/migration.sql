-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "forProductId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_forProductId_fkey" FOREIGN KEY ("forProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
