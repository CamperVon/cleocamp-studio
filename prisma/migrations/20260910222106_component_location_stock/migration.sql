-- AlterEnum
ALTER TYPE "InventoryEventType" ADD VALUE 'TRANSFER';

-- DropForeignKey
ALTER TABLE "Component" DROP CONSTRAINT "Component_locationId_fkey";

-- AlterTable
ALTER TABLE "Component" DROP COLUMN "locationId";

-- AlterTable
ALTER TABLE "InventoryEvent" ADD COLUMN     "atVendorId" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "transferGroupId" TEXT;

-- CreateTable
CREATE TABLE "ComponentLocationStock" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "locationId" TEXT,
    "atVendorId" TEXT,
    "qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentLocationStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComponentLocationStock_componentId_locationId_key" ON "ComponentLocationStock"("componentId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentLocationStock_componentId_atVendorId_key" ON "ComponentLocationStock"("componentId", "atVendorId");

-- AddForeignKey
ALTER TABLE "ComponentLocationStock" ADD CONSTRAINT "ComponentLocationStock_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentLocationStock" ADD CONSTRAINT "ComponentLocationStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentLocationStock" ADD CONSTRAINT "ComponentLocationStock_atVendorId_fkey" FOREIGN KEY ("atVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_atVendorId_fkey" FOREIGN KEY ("atVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

