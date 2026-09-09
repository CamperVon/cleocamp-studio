-- AlterTable
ALTER TABLE "DocumentDefaults" ADD COLUMN     "confirmLineEs" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "documentLanguage" TEXT;
