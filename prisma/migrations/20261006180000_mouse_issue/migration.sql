-- Mouse's troubleshooting log.
CREATE TABLE "MouseIssue" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tool" TEXT,
    "detail" TEXT NOT NULL,
    "input" JSONB,
    "asked" TEXT,
    "times" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fixedAt" TIMESTAMP(3),
    "fixNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MouseIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MouseIssue_fixedAt_lastSeenAt_idx" ON "MouseIssue"("fixedAt", "lastSeenAt");
