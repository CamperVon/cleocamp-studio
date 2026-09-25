-- Who a team note on a support case was emailed to (Jane), so the page can show it.
ALTER TABLE "SupportMessage" ADD COLUMN "emailedTo" TEXT;
