-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "status" TEXT NOT NULL DEFAULT 'skeleton',
    "arxivId" TEXT,
    "doi" TEXT,
    "venue" TEXT,
    "plannedVenue" TEXT,
    "submittedAt" DATETIME,
    "publishedAt" DATETIME,
    "primaryProjectId" TEXT,
    CONSTRAINT "Paper_primaryProjectId_fkey" FOREIGN KEY ("primaryProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "paperId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "title" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PaperSection_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HypothesisPaper" (
    "hypothesisId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("hypothesisId", "paperId"),
    CONSTRAINT "HypothesisPaper_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HypothesisPaper_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'paper',
    "title" TEXT NOT NULL,
    "authors" TEXT,
    "url" TEXT,
    "arxivId" TEXT,
    "summaryMd" TEXT,
    "takeaway" TEXT
);

-- CreateTable
CREATE TABLE "NoteProject" (
    "noteId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    PRIMARY KEY ("noteId", "projectId"),
    CONSTRAINT "NoteProject_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "path" TEXT NOT NULL,
    "caption" TEXT,
    "projectId" TEXT,
    "runId" TEXT,
    "paperId" TEXT,
    "paperSectionId" TEXT,
    CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_paperSectionId_fkey" FOREIGN KEY ("paperSectionId") REFERENCES "PaperSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Artifact" ("caption", "createdAt", "id", "kind", "path", "projectId", "runId") SELECT "caption", "createdAt", "id", "kind", "path", "projectId", "runId" FROM "Artifact";
DROP TABLE "Artifact";
ALTER TABLE "new_Artifact" RENAME TO "Artifact";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
