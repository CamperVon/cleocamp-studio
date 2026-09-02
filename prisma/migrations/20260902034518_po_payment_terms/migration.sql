-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "depositPercent" INTEGER,
ADD COLUMN     "netDaysAfterDelivery" INTEGER,
ADD COLUMN     "paymentTerms" TEXT;
