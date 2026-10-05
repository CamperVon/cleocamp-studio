-- The stylist inventory, kept apart from sales stock (Brandon, 5 Oct 2026).
ALTER TABLE "StylistPullLine" ADD COLUMN "fromStylistQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "StylistRequest" ADD COLUMN "pieces" JSONB;

CREATE TABLE "StylistStockEvent" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "pullId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StylistStockEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StylistStockEvent_productVariantId_idx" ON "StylistStockEvent"("productVariantId");

CREATE INDEX "StylistStockEvent_pullId_idx" ON "StylistStockEvent"("pullId");

ALTER TABLE "StylistStockEvent" ADD CONSTRAINT "StylistStockEvent_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
