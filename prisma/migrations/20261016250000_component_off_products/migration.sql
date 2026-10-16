-- Components left off products on purpose (16 Oct 2026).
ALTER TABLE "Component" ADD COLUMN "offProducts" BOOLEAN NOT NULL DEFAULT false;
