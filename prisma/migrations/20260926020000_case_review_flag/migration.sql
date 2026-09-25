-- A support case flagged for Brandon and Claude: Mouse got something wrong that needs reprogramming.
ALTER TABLE "SupportCase" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "SupportCase" ADD COLUMN "reviewRequestedBy" TEXT;
ALTER TABLE "SupportCase" ADD COLUMN "reviewReason" TEXT;
ALTER TABLE "SupportCase" ADD COLUMN "reviewDraft" TEXT;
ALTER TABLE "SupportCase" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "SupportCase" ADD COLUMN "reviewOutcome" TEXT;
