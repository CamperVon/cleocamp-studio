-- Research tasks handed to Muse, an outside assistant, and its questions.
-- New tables only; nothing existing changes.
CREATE TABLE "MuseTask" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "records" JSONB,
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "summary" TEXT,
    "report" TEXT,
    "sources" JSONB,
    "reportFileId" TEXT,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "MuseTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MuseTask_number_key" ON "MuseTask"("number");
CREATE INDEX "MuseTask_status_createdAt_idx" ON "MuseTask"("status", "createdAt");

CREATE TABLE "MuseQuestion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASKED_TEAM',
    "actionItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "MuseQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MuseQuestion_taskId_createdAt_idx" ON "MuseQuestion"("taskId", "createdAt");
ALTER TABLE "MuseQuestion" ADD CONSTRAINT "MuseQuestion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MuseTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
