-- Close or remove a stylist pull from the Stylists page (Brandon, 30 Sept 2026).
ALTER TABLE "StylistPull" ADD COLUMN "closedAs" TEXT;
ALTER TABLE "StylistPull" ADD COLUMN "closedAt" TIMESTAMP(3);
