-- CreateTable
CREATE TABLE "ModelUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "cacheWrite1hTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,

    CONSTRAINT "ModelUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelUsage_createdAt_idx" ON "ModelUsage"("createdAt");

-- CreateIndex
CREATE INDEX "ModelUsage_source_createdAt_idx" ON "ModelUsage"("source", "createdAt");
