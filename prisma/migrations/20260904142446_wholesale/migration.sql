-- CreateEnum
CREATE TYPE "WholesaleAccountType" AS ENUM ('WHOLESALE', 'CONSIGNMENT');

-- CreateTable
CREATE TABLE "WholesaleAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WholesaleAccountType" NOT NULL DEFAULT 'WHOLESALE',
    "commissionSplit" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleShipment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "paid" BOOLEAN,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "wholesaleCents" INTEGER,
    "soldAt" TIMESTAMP(3),

    CONSTRAINT "WholesaleShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WholesaleAccount_active_idx" ON "WholesaleAccount"("active");

-- CreateIndex
CREATE INDEX "WholesaleShipment_accountId_sentAt_idx" ON "WholesaleShipment"("accountId", "sentAt");

-- CreateIndex
CREATE INDEX "WholesaleShipmentLine_shipmentId_idx" ON "WholesaleShipmentLine"("shipmentId");

-- AddForeignKey
ALTER TABLE "WholesaleShipment" ADD CONSTRAINT "WholesaleShipment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WholesaleAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleShipmentLine" ADD CONSTRAINT "WholesaleShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "WholesaleShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
