-- CreateTable
CREATE TABLE "SentEmail" (
    "id" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "ccAddress" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentBy" TEXT,
    "resendId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentEmail_createdAt_idx" ON "SentEmail"("createdAt");
