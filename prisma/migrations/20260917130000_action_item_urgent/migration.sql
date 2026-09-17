-- Urgency stated outright, independent of any date. dueDate plus
-- remindDaysBefore already covers "surface this N days before it's due" —
-- this covers "Cleo said it's pressing" when there may be no date at all to
-- hang that on. Additive and defaulted false, so every existing row reads
-- exactly as it did before this column existed.
ALTER TABLE "ActionItem" ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;
