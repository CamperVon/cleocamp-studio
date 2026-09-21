-- The nightly pass's own working notes, kept beside the brief they produced.
--
-- composeDailyBrief() takes them as an argument and distils them under Mouse's
-- voice. The cron had the only copy and dropped it on the floor, so anything
-- regenerating the brief later composed it from open items alone and silently
-- lost whatever the night's mail had surfaced. Nullable: every row written
-- before this column existed has no notes to recover, and a day with no unread
-- mail legitimately has none.
ALTER TABLE "DailyBrief" ADD COLUMN "overnight" TEXT;
