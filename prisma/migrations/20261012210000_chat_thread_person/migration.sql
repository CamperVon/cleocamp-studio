-- AlterTable
ALTER TABLE "ChatThread" ADD COLUMN "personId" TEXT;

-- CreateIndex
CREATE INDEX "ChatThread_personId_idx" ON "ChatThread"("personId");
