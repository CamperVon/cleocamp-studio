-- Muse reports carry each find set against what we pay now.
ALTER TABLE "MuseTask" ADD COLUMN "comparisons" JSONB;
