-- A cropped photo chosen for a line sheet row (Brandon, 1 Oct 2026).
ALTER TABLE "LineSheetRow" ADD COLUMN "photoData" BYTEA;
ALTER TABLE "LineSheetRow" ADD COLUMN "photoSource" TEXT;
