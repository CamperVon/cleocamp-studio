-- CreateTable
CREATE TABLE "TelnyxMessage" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT,
    "text" TEXT NOT NULL,
    "channel" TEXT,
    "signed" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelnyxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelnyxMessage_providerId_key" ON "TelnyxMessage"("providerId");

-- CreateIndex
CREATE INDEX "TelnyxMessage_receivedAt_idx" ON "TelnyxMessage"("receivedAt");
