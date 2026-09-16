-- A calendar entry is nearly always about a product: 18 skirts arriving, a
-- pickup from the dye house, an order-by date. Nothing recorded which, so the
-- only way to ask "what is happening to the 5to7 Skirt" was to read every
-- event and match on wording. Nullable because plenty of entries are genuinely
-- about nobody's product — a studio visit, a call.
ALTER TABLE "CalendarEvent" ADD COLUMN "productId" TEXT;
CREATE INDEX "CalendarEvent_productId_idx" ON "CalendarEvent"("productId");
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
