-- AlterTable
ALTER TABLE "SupportCase" ADD COLUMN     "draftAddress" JSONB,
ADD COLUMN     "draftNeeds" TEXT,
ADD COLUMN     "draftReply" TEXT,
ADD COLUMN     "draftedAt" TIMESTAMP(3);
