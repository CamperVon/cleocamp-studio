-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('WRONG_ITEM', 'DAMAGED', 'WHERE_IS_MY_ORDER', 'RETURN_EXCHANGE', 'SIZING_QUESTION', 'PRODUCT_QUESTION', 'ORDER_CHANGE', 'WHOLESALE', 'PRESS', 'COMPLIMENT', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportUrgency" AS ENUM ('NOW', 'TODAY', 'DIGEST');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'WAITING_ON_CUSTOMER', 'WAITING_ON_RETURN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SupportDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'NOTE');

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "subject" TEXT,
    "category" "SupportCategory" NOT NULL DEFAULT 'OTHER',
    "urgency" "SupportUrgency" NOT NULL DEFAULT 'TODAY',
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT,
    "shopifyOrderName" TEXT,
    "shopifyOrderId" TEXT,
    "orderSnapshot" JSONB,
    "alertedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "direction" "SupportDirection" NOT NULL,
    "fromAddress" TEXT,
    "body" TEXT NOT NULL,
    "inboundEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportCase_status_urgency_idx" ON "SupportCase"("status", "urgency");

-- CreateIndex
CREATE INDEX "SupportCase_customerEmail_idx" ON "SupportCase"("customerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_inboundEmailId_key" ON "SupportMessage"("inboundEmailId");

-- CreateIndex
CREATE INDEX "SupportMessage_caseId_createdAt_idx" ON "SupportMessage"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
