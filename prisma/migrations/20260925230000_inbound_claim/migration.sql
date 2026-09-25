-- One support pass at a time per email.
ALTER TABLE "InboundEmail" ADD COLUMN "claimedAt" TIMESTAMP(3);
