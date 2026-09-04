-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "contactLines" TEXT;

-- CreateTable
CREATE TABLE "DocumentDefaults" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "billToLines" TEXT NOT NULL,
    "confirmLine" TEXT NOT NULL,
    "contactLines" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentDefaults_pkey" PRIMARY KEY ("id")
);
