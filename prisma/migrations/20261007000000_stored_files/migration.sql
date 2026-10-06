-- Documents kept for good (colour cards, spec sheets), linked to products,
-- components and vendors. New tables only; nothing existing changes.
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoredFile_createdAt_idx" ON "StoredFile"("createdAt");

CREATE TABLE "StoredFileLink" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFileLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoredFileLink_fileId_kind_recordId_key" ON "StoredFileLink"("fileId", "kind", "recordId");
CREATE INDEX "StoredFileLink_kind_recordId_idx" ON "StoredFileLink"("kind", "recordId");
ALTER TABLE "StoredFileLink" ADD CONSTRAINT "StoredFileLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
