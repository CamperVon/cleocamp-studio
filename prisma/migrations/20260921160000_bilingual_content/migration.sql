-- The order itself in the document's second language, not just its labels.
--
-- Brandon, 21 Sept 2026: "These multi lingual POs need to have the actual
-- order in both languages." Until now a bilingual PO printed ITEM / ARTICOLO
-- over a line that read only in English, which is half a document.
--
-- STORED, NOT TRANSLATED AT RENDER TIME. That line is the one lib/po-strings.ts
-- already draws and it holds: chrome is a closed set that can be got right
-- once, content is written fresh each time, and a machine translation of
-- "50% on order, balance on delivery" that comes out subtly wrong is a real
-- invoice dispute with a real factory. These columns hold a sentence somebody
-- wrote, and are null until somebody does.
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "descriptionAlt" TEXT;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "unitAlt" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "paymentTermsAlt" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "notesAlt" TEXT;
