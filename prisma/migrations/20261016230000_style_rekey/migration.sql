-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "previousSku" TEXT;

-- CreateTable
CREATE TABLE "RetiredStyleNumber" (
    "number" TEXT NOT NULL,
    "replacedBy" TEXT,
    "note" TEXT,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetiredStyleNumber_pkey" PRIMARY KEY ("number")
);

