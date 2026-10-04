-- CreateTable
CREATE TABLE "CustomerNotice" (
    "id" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "resendId" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerNotice_campaign_orderId_key" ON "CustomerNotice"("campaign", "orderId");

-- CreateIndex
CREATE INDEX "CustomerNotice_campaign_idx" ON "CustomerNotice"("campaign");
