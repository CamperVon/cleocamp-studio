-- Whether this person works for Cleo Camp or for somebody Cleo Camp works
-- with. Nicki is Antonio's project manager: real, active, on plenty of
-- purchase orders, and not somebody who is ever handed the keys to the app.
--
-- A flag rather than deactivating her, because `active` already means
-- something else — that a person is still around at all — and switching her
-- off to tidy one page would quietly take her out of everywhere else she is
-- correctly used.
ALTER TABLE "Person" ADD COLUMN "external" BOOLEAN NOT NULL DEFAULT false;
