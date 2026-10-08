-- Style numbers (8 Oct 2026). Additive only: new tables, nullable columns,
-- one column with a default. Rollback: docs/style-system/rollback.sql.
-- CreateEnum
CREATE TYPE "StyleStatus" AS ENUM ('ACTIVE', 'DRAFT', 'DEVELOPMENT', 'NOT_LIVE', 'LIVE_ONLY', 'PROPOSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "StyleCodeType" AS ENUM ('CATEGORY', 'COLOR', 'SIZE');

-- CreateEnum
CREATE TYPE "StyleCodeStatus" AS ENUM ('CONFIRMED', 'PROPOSED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "styleId" TEXT;

-- AlterTable
ALTER TABLE "Colorway" ADD COLUMN     "colorCode" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "colorCode" TEXT,
ADD COLUMN     "newSku" TEXT,
ADD COLUMN     "shopifySku" TEXT,
ADD COLUMN     "sizeCode" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "snapColorway" TEXT,
ADD COLUMN     "snapImageUrl" TEXT,
ADD COLUMN     "snapProductName" TEXT,
ADD COLUMN     "snapSize" TEXT,
ADD COLUMN     "snapSku" TEXT,
ADD COLUMN     "snapStyleNumber" TEXT,
ADD COLUMN     "snapshotAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentDefaults" ADD COLUMN     "skuDisplayMode" TEXT NOT NULL DEFAULT 'transition';

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "status" "StyleStatus" NOT NULL,
    "sizes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleCode" (
    "id" TEXT NOT NULL,
    "type" "StyleCodeType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legacyCode" TEXT,
    "status" "StyleCodeStatus" NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitPart" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "matchColour" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Style_number_key" ON "Style"("number");

-- CreateIndex
CREATE UNIQUE INDEX "StyleCode_type_code_key" ON "StyleCode"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KitPart_parentId_partId_key" ON "KitPart"("parentId", "partId");

-- CreateIndex
CREATE INDEX "Product_styleId_idx" ON "Product"("styleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_newSku_key" ON "ProductVariant"("newSku");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitPart" ADD CONSTRAINT "KitPart_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitPart" ADD CONSTRAINT "KitPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

