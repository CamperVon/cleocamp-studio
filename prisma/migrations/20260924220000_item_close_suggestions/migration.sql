-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "closeSuggestedAt" TIMESTAMP(3),
ADD COLUMN     "closeSuggestion" TEXT,
ADD COLUMN     "keptOpenAt" TIMESTAMP(3);
