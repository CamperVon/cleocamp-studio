-- CreateTable
CREATE TABLE "DriveRecent" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,
    "modifiedBy" TEXT,
    "position" INTEGER NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveRecent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveRecent_fileId_key" ON "DriveRecent"("fileId");

