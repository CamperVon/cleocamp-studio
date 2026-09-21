-- A per-person secret for the "tell Mouse" doors (Siri shortcut, home-screen
-- page). The app's own login is one shared password whose session carries no
-- identity at all, so until now nothing arriving from a phone could say WHO
-- was speaking. An update is worth much less without that: "the cotton
-- arrived" needs an author as much as it needs a date.
--
-- Nullable because most people will never have one, and unique so a token
-- resolves to exactly one person or to nobody.
ALTER TABLE "Person" ADD COLUMN "sayToken" TEXT;
CREATE UNIQUE INDEX "Person_sayToken_key" ON "Person"("sayToken");
