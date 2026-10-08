-- Undo 20261008150000_style_system. Nothing else depends on these yet.
-- Run by hand, then delete that row from "_prisma_migrations".
-- The PO line snapshot columns are what keep sent POs frozen: drop them only
-- if no SKU has changed since, or sent POs will start reading live values.
ALTER TABLE "KitPart" DROP CONSTRAINT "KitPart_partId_fkey";
ALTER TABLE "KitPart" DROP CONSTRAINT "KitPart_parentId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT "Product_styleId_fkey";
DROP TABLE "KitPart";
DROP TABLE "StyleCode";
DROP TABLE "Style";
ALTER TABLE "Product" DROP COLUMN "styleId";
ALTER TABLE "Colorway" DROP COLUMN "colorCode";
ALTER TABLE "ProductVariant" DROP COLUMN "colorCode", DROP COLUMN "newSku", DROP COLUMN "shopifySku", DROP COLUMN "sizeCode";
ALTER TABLE "PurchaseOrderLine" DROP COLUMN "snapColorway", DROP COLUMN "snapImageUrl", DROP COLUMN "snapProductName", DROP COLUMN "snapSize", DROP COLUMN "snapSku", DROP COLUMN "snapStyleNumber", DROP COLUMN "snapshotAt";
ALTER TABLE "DocumentDefaults" DROP COLUMN "skuDisplayMode";
DROP TYPE "StyleCodeStatus";
DROP TYPE "StyleCodeType";
DROP TYPE "StyleStatus";
