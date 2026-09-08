-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "chipAwayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "amReportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);
