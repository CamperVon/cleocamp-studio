-- When Mouse emailed an answer to a question in this mail.
ALTER TABLE "InboundEmail" ADD COLUMN "answeredAt" TIMESTAMP(3);
