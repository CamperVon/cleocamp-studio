
-- CreateEnum
CREATE TYPE "StylistRequestStatus" AS ENUM ('OPEN', 'TOLD', 'FULFILLED', 'CLOSED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stylistReserveQty" INTEGER;

-- CreateTable
CREATE TABLE "Stylist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "instagram" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistPull" (
    "id" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "dueBackAt" TIMESTAMP(3),
    "project" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylistPull_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistPullLine" (
    "id" TEXT NOT NULL,
    "pullId" TEXT NOT NULL,
    "productVariantId" TEXT,
    "item" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "StylistPullLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistRequest" (
    "id" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "productVariantId" TEXT,
    "qty" INTEGER,
    "neededBy" TIMESTAMP(3),
    "status" "StylistRequestStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylistRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Stylist_email_key" ON "Stylist"("email");

-- CreateIndex
CREATE INDEX "StylistPull_stylistId_sentAt_idx" ON "StylistPull"("stylistId", "sentAt");

-- CreateIndex
CREATE INDEX "StylistPullLine_pullId_idx" ON "StylistPullLine"("pullId");

-- CreateIndex
CREATE INDEX "StylistRequest_status_idx" ON "StylistRequest"("status");

-- AddForeignKey
ALTER TABLE "StylistPull" ADD CONSTRAINT "StylistPull_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistPullLine" ADD CONSTRAINT "StylistPullLine_pullId_fkey" FOREIGN KEY ("pullId") REFERENCES "StylistPull"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistRequest" ADD CONSTRAINT "StylistRequest_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

