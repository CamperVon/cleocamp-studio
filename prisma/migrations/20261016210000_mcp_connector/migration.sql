-- CreateTable
CREATE TABLE "McpClient" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "redirectUris" TEXT[],
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "secretHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpGrant" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "personId" TEXT,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "codeChallenge" TEXT,
    "redirectUri" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpCall" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorKind" TEXT,
    "durationMs" INTEGER NOT NULL,
    "clientId" TEXT,
    "personId" TEXT,

    CONSTRAINT "McpCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_tokenHash_key" ON "McpGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "McpGrant_familyId_idx" ON "McpGrant"("familyId");

-- CreateIndex
CREATE INDEX "McpGrant_clientId_kind_idx" ON "McpGrant"("clientId", "kind");

-- CreateIndex
CREATE INDEX "McpCall_createdAt_idx" ON "McpCall"("createdAt");

-- AddForeignKey
ALTER TABLE "McpGrant" ADD CONSTRAINT "McpGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

