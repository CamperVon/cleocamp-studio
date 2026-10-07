-- An invoice the team asked for on a support case, set up for one tap.
ALTER TABLE "SupportCase" ADD COLUMN "draftInvoice" JSONB;
