-- Digits only. Recognises someone by the phone number embedded in an
-- SMS-to-email gateway address (3106223898@tmomail.net, @vtext.com,
-- @txt.att.net, ...) when the gateway domain isn't known or doesn't match
-- an already-recorded alias. A substring match on the number, not one more
-- exact address in aliasEmails.
ALTER TABLE "Person" ADD COLUMN "phone" TEXT;
