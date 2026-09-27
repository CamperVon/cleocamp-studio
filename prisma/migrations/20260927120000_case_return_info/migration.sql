-- A return received at the studio: what came back, refund or exchange, and the refund once approved.
ALTER TABLE "SupportCase" ADD COLUMN "returnInfo" JSONB;
