-- A wholesale shipment invoiced through Shopify carries its order, so paid comes from Shopify.
ALTER TABLE "WholesaleShipment" ADD COLUMN "shopifyOrderId" TEXT;
ALTER TABLE "WholesaleShipment" ADD COLUMN "invoiceName" TEXT;
CREATE UNIQUE INDEX "WholesaleShipment_shopifyOrderId_key" ON "WholesaleShipment"("shopifyOrderId");
