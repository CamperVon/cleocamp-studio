-- What a store pays, from the wholesale line sheet. Null = unknown, ask.
ALTER TABLE "Product" ADD COLUMN "wholesalePriceCents" INTEGER;
ALTER TABLE "ProductVariant" ADD COLUMN "wholesalePriceCents" INTEGER;
