-- CreateEnum
CREATE TYPE "VendorRole" AS ENUM ('COMPONENT_SUPPLIER', 'MANUFACTURER', 'DYE_HOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DEVELOPMENT', 'SAMPLING', 'ACTIVE', 'SUNSETTED');

-- CreateEnum
CREATE TYPE "ComponentCategory" AS ENUM ('MATERIAL', 'TRIM', 'HARDWARE', 'PACKAGING', 'SUBASSEMBLY');

-- CreateEnum
CREATE TYPE "InventoryEventType" AS ENUM ('RECEIVED', 'USED', 'COUNTED', 'MANUAL_ADJUST', 'GIFTED', 'WHOLESALE_SHIPPED', 'STYLIST_PULL_OUT', 'STYLIST_PULL_RETURN', 'RETURNED', 'CORRECTION');

-- CreateEnum
CREATE TYPE "InventoryEventSource" AS ENUM ('CHAT', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('PLANNED', 'COMPONENTS_ORDERED', 'IN_PRODUCTION', 'AT_DYE_HOUSE', 'FINISHING', 'READY_FOR_PICKUP', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('VENDOR', 'PRODUCT', 'PRODUCT_VARIANT', 'COMPONENT', 'PRODUCTION_RUN', 'PURCHASE_ORDER', 'GENERAL');

-- CreateEnum
CREATE TYPE "ActionItemKind" AS ENUM ('QUESTION', 'TODO');

-- CreateEnum
CREATE TYPE "ActionItemSource" AS ENUM ('CHAT', 'EMAIL', 'SYSTEM', 'MANUAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'URGENT');

-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('CHAT', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('ORDER_BY', 'PRODUCTION_DUE', 'PRESS_OR_EVENT', 'DELIVERY_EXPECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarEventSource" AS ENUM ('STUDIO_MOUSE', 'GOOGLE', 'MANUAL');

-- CreateEnum
CREATE TYPE "DigestKind" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "role" "VendorRole" NOT NULL DEFAULT 'COMPONENT_SUPPLIER',
    "contactName" TEXT,
    "contactInfo" TEXT,
    "address" TEXT,
    "orderMethod" TEXT,
    "paymentTerms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DEVELOPMENT',
    "productionLeadTimeDays" INTEGER,
    "retailPriceCents" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Colorway" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "dyeHouseName" TEXT,
    "pantone" TEXT,
    "inHouseMatch" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "Colorway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colorwayId" TEXT,
    "shopifyVariantId" TEXT,
    "size" TEXT,
    "locationId" TEXT,
    "onHandQty" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ComponentCategory" NOT NULL DEFAULT 'MATERIAL',
    "vendorId" TEXT,
    "vendorSku" TEXT,
    "vendorDescription" TEXT,
    "spec" TEXT,
    "unitOfMeasure" TEXT NOT NULL,
    "purchaseUnit" TEXT,
    "unitsPerPurchaseUnit" DECIMAL(12,3),
    "leadTimeDays" INTEGER,
    "unitCostCents" INTEGER,
    "reorderThreshold" DECIMAL(12,3),
    "onHandQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "incomingQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" TEXT NOT NULL,
    "parentProductId" TEXT,
    "parentComponentId" TEXT,
    "componentId" TEXT NOT NULL,
    "qtyPerUnit" DECIMAL(12,4) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" TEXT NOT NULL,
    "componentId" TEXT,
    "productVariantId" TEXT,
    "deltaQty" DECIMAL(12,3) NOT NULL,
    "countedQty" DECIMAL(12,3),
    "type" "InventoryEventType" NOT NULL,
    "source" "InventoryEventSource" NOT NULL DEFAULT 'CHAT',
    "note" TEXT,
    "createdById" TEXT,
    "chatMessageId" TEXT,
    "correctsEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT,
    "cutRef" TEXT,
    "status" "ProductionStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMP(3),
    "expectedReadyAt" TIMESTAMP(3),
    "dateConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRunLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(12,3) NOT NULL,
    "qtyReceived" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRunCost" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isPerUnit" BOOLEAN NOT NULL DEFAULT false,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "ProductionRunCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "shipToLocationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCostCents" INTEGER,
    "qtyReceived" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "kind" "ActionItemKind" NOT NULL DEFAULT 'QUESTION',
    "entityType" "EntityType" NOT NULL DEFAULT 'GENERAL',
    "entityId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueDate" TIMESTAMP(3),
    "remindDaysBefore" INTEGER DEFAULT 3,
    "createdById" TEXT,
    "assignedToId" TEXT,
    "source" "ActionItemSource" NOT NULL DEFAULT 'CHAT',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "relatedActionItemId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL DEFAULT 'GENERAL',
    "entityId" TEXT,
    "content" TEXT NOT NULL,
    "source" "NoteSource" NOT NULL DEFAULT 'CHAT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCallsJson" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesSnapshot" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'shopify',

    CONSTRAINT "SalesSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastResult" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "componentId" TEXT,
    "projectedStockoutDate" TIMESTAMP(3),
    "recommendedOrderDate" TIMESTAMP(3),
    "note" TEXT,
    "blockedReason" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "forecastResultId" TEXT,
    "googleEventId" TEXT,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "CalendarEventType" NOT NULL DEFAULT 'OTHER',
    "source" "CalendarEventSource" NOT NULL DEFAULT 'STUDIO_MOUSE',
    "status" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileLink" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestSend" (
    "id" TEXT NOT NULL,
    "kind" "DigestKind" NOT NULL,
    "sentForDate" DATE NOT NULL,
    "recipients" TEXT NOT NULL,
    "subject" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Vendor_active_role_idx" ON "Vendor"("active", "role");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Colorway_active_idx" ON "Colorway"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Colorway_productId_customerName_key" ON "Colorway"("productId", "customerName");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "Component_active_category_idx" ON "Component"("active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "BomLine_parentProductId_componentId_key" ON "BomLine"("parentProductId", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX "BomLine_parentComponentId_componentId_key" ON "BomLine"("parentComponentId", "componentId");

-- CreateIndex
CREATE INDEX "InventoryEvent_componentId_createdAt_idx" ON "InventoryEvent"("componentId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryEvent_productVariantId_createdAt_idx" ON "InventoryEvent"("productVariantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryEvent_type_createdAt_idx" ON "InventoryEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionRun_status_idx" ON "ProductionRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "ActionItem_resolved_dueDate_idx" ON "ActionItem"("resolved", "dueDate");

-- CreateIndex
CREATE INDEX "ActionItem_kind_resolved_idx" ON "ActionItem"("kind", "resolved");

-- CreateIndex
CREATE INDEX "Alert_resolved_createdAt_idx" ON "Alert"("resolved", "createdAt");

-- CreateIndex
CREATE INDEX "Note_entityType_entityId_idx" ON "Note"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesSnapshot_date_idx" ON "SalesSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesSnapshot_productVariantId_date_source_key" ON "SalesSnapshot"("productVariantId", "date", "source");

-- CreateIndex
CREATE INDEX "ForecastResult_computedAt_idx" ON "ForecastResult"("computedAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_date_idx" ON "CalendarEvent"("date");

-- CreateIndex
CREATE INDEX "FileLink_category_sortOrder_idx" ON "FileLink"("category", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DigestSend_kind_sentForDate_key" ON "DigestSend"("kind", "sentForDate");

-- AddForeignKey
ALTER TABLE "Colorway" ADD CONSTRAINT "Colorway_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorwayId_fkey" FOREIGN KEY ("colorwayId") REFERENCES "Colorway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_parentComponentId_fkey" FOREIGN KEY ("parentComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_correctsEventId_fkey" FOREIGN KEY ("correctsEventId") REFERENCES "InventoryEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunLine" ADD CONSTRAINT "ProductionRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunLine" ADD CONSTRAINT "ProductionRunLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunCost" ADD CONSTRAINT "ProductionRunCost_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_relatedActionItemId_fkey" FOREIGN KEY ("relatedActionItemId") REFERENCES "ActionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesSnapshot" ADD CONSTRAINT "SalesSnapshot_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastResult" ADD CONSTRAINT "ForecastResult_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastResult" ADD CONSTRAINT "ForecastResult_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_forecastResultId_fkey" FOREIGN KEY ("forecastResultId") REFERENCES "ForecastResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Invariants Prisma's schema language cannot express.
-- See CLAUDE.md §3.
-- ─────────────────────────────────────────────────────────────

-- A BOM line hangs off exactly one parent: a Product, or another Component
-- (sub-assemblies such as the Bateau handles). Never both, never neither.
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_exactly_one_parent"
  CHECK (
    ("parentProductId" IS NOT NULL)::int + ("parentComponentId" IS NOT NULL)::int = 1
  );

-- An inventory event moves exactly one thing: a Component or a ProductVariant.
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_exactly_one_subject"
  CHECK (
    ("componentId" IS NOT NULL)::int + ("productVariantId" IS NOT NULL)::int = 1
  );

-- A COUNTED event must record the absolute number that was actually stated.
-- Storing only the derived delta loses what Cleo said, which is the point of
-- keeping an audit trail at all.
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_counted_records_absolute"
  CHECK ("type" <> 'COUNTED' OR "countedQty" IS NOT NULL);

-- At most one UNRESOLVED alert per condition. This is what makes the nightly
-- cron safe to run repeatedly without spamming duplicate alerts for a
-- condition that is still true.
CREATE UNIQUE INDEX "Alert_dedupeKey_unresolved"
  ON "Alert" ("dedupeKey") WHERE "resolved" = false;
