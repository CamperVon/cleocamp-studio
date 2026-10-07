-- A product's recipe can hold one line per component per size and colour,
-- not just one per component. NULLS NOT DISTINCT keeps two all-variants lines
-- for the same component from both existing. Existing rows already satisfy it.
DROP INDEX "BomLine_parentProductId_componentId_key";
CREATE UNIQUE INDEX "BomLine_parentProductId_componentId_size_colorway_key" ON "BomLine"("parentProductId", "componentId", "size", "colorway") NULLS NOT DISTINCT;
