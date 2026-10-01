-- Friends of the brand (Brandon, 1 Oct 2026).
CREATE TABLE "FriendOfBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "instagram" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendOfBrand_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FriendOfBrand_removedAt_idx" ON "FriendOfBrand"("removedAt");
