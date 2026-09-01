-- CreateTable
CREATE TABLE "DailyBrief" (
    "id" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyBrief_forDate_key" ON "DailyBrief"("forDate");
