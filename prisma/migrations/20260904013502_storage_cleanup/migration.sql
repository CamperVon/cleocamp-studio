-- AlterTable
ALTER TABLE "ChatAttachment" ALTER COLUMN "data" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StorageCleanup" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastRunAt" TIMESTAMP(3),
    "emailsPurged" INTEGER NOT NULL DEFAULT 0,
    "filesPurged" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StorageCleanup_pkey" PRIMARY KEY ("id")
);
