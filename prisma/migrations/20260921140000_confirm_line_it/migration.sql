-- The standing confirm sentence in Italian, for Cinturificiog's belt orders.
-- Sits beside confirmLineEs for the same reason that one exists: the sentence
-- telling a vendor what to do next is CONTENT, written by a person, never
-- machine-translated chrome. Null falls back to English.
ALTER TABLE "DocumentDefaults" ADD COLUMN "confirmLineIt" TEXT;
