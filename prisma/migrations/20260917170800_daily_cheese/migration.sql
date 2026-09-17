-- The Daily Cheese: weekday 8am report, replacing the morning report.
-- Additive and defaulted, so every existing NotificationSettings row keeps
-- reading correctly. amReportEnabled flips to false in the same migration
-- since The Daily Cheese supersedes it (Cleo, 17 Sept 2026) — the column
-- itself stays, same as digestEnabled before it, in case it's ever wanted
-- back.
ALTER TABLE "NotificationSettings" ADD COLUMN "dailyCheeseEnabled" BOOLEAN NOT NULL DEFAULT true;
UPDATE "NotificationSettings" SET "amReportEnabled" = false;
