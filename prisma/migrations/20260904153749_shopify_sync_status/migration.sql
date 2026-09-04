-- CreateTable
CREATE TABLE "ShopifySyncStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "variantsUpdated" INTEGER NOT NULL,

    CONSTRAINT "ShopifySyncStatus_pkey" PRIMARY KEY ("id")
);
