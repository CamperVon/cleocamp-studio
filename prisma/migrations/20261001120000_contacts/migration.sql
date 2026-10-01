-- Friends of the Brand becomes one of three circles on a Contact, beside the
-- Cleo Crew's two (Brandon, 1 Oct 2026). The table was empty when renamed.
CREATE TYPE "ContactCircle" AS ENUM ('FRIEND_OF_BRAND', 'CREW', 'WORKS_WITH');
ALTER TABLE "FriendOfBrand" RENAME TO "Contact";
ALTER TABLE "Contact" RENAME CONSTRAINT "FriendOfBrand_pkey" TO "Contact_pkey";
ALTER TABLE "Contact" ADD COLUMN "circle" "ContactCircle" NOT NULL DEFAULT 'FRIEND_OF_BRAND';
DROP INDEX "FriendOfBrand_removedAt_idx";
CREATE INDEX "Contact_circle_removedAt_idx" ON "Contact"("circle", "removedAt");
