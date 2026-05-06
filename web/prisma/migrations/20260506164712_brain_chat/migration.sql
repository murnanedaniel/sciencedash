-- CreateTable
CREATE TABLE "BrainChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "transcriptMd" TEXT NOT NULL,
    "summaryMd" TEXT,
    "summarizedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "BrainChat_createdAt_idx" ON "BrainChat"("createdAt");

-- CreateIndex
CREATE INDEX "BrainChat_summarizedAt_idx" ON "BrainChat"("summarizedAt");
