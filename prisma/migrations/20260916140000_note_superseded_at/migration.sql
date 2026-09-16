-- A note that has been replaced is not deleted. It is marked here with the
-- moment it stopped being current, so the fact it records can still be looked
-- up while never being read back as though it were true today.
--
-- Additive and nullable: existing notes are all current, which is what NULL
-- means. No rewrite of any row, no lock worth speaking of.
ALTER TABLE "Note" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- Almost every read wants only the live ones.
CREATE INDEX "Note_supersededAt_idx" ON "Note"("supersededAt");
