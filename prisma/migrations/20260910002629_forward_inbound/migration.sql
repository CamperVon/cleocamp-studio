-- AlterTable
ALTER TABLE "InboundEmail" ADD COLUMN     "forwardedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationSettings" ADD COLUMN     "forwardInboundEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "forwardInboundTo" TEXT;
