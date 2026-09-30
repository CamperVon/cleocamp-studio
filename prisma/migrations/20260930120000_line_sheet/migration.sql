-- CreateTable
CREATE TABLE "LineSheetRow" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "colorway" TEXT,
    "item" TEXT NOT NULL,
    "colorLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "wholesaleCents" INTEGER,
    "msrp" TEXT NOT NULL,
    "sizing" TEXT NOT NULL,
    "minOrder" TEXT NOT NULL,
    "commission" TEXT,
    "availability" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineSheetRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineSheetRow_position_idx" ON "LineSheetRow"("position");

-- CreateTable
CREATE TABLE "LineSheetMeta" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "materials" TEXT NOT NULL,
    "press" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "footnote" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineSheetMeta_pkey" PRIMARY KEY ("id")
);
