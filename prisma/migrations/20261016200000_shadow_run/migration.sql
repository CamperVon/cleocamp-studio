-- CreateTable
CREATE TABLE "ShadowRun" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "codeVersion" TEXT,
    "deploymentId" TEXT,
    "resultJson" JSONB,
    "error" TEXT,

    CONSTRAINT "ShadowRun_pkey" PRIMARY KEY ("key")
);
