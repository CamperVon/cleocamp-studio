-- CreateEnum
CREATE TYPE "PatternStatus" AS ENUM ('ACTIVE', 'RETIRING', 'ARCHIVED');

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "patternId" TEXT,
ADD COLUMN     "snapPattern" TEXT;

-- CreateTable
CREATE TABLE "Pattern" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fabric" TEXT,
    "heldBy" TEXT,
    "status" "PatternStatus" NOT NULL DEFAULT 'ACTIVE',
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pattern_code_key" ON "Pattern"("code");

-- CreateIndex
CREATE INDEX "Pattern_styleId_idx" ON "Pattern"("styleId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pattern" ADD CONSTRAINT "Pattern_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

