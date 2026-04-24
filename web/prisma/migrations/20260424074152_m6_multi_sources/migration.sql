/*
  Warnings:

  - You are about to drop the column `githubRepoUrl` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `wandbEntity` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `wandbProject` on the `Project` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "WandbSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "WandbSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepoLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "cachedLastCommitSha" TEXT,
    "cachedLastCommitAt" DATETIME,
    CONSTRAINT "RepoLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "description" TEXT,
    "hypothesis" TEXT,
    "figuresOfMerit" TEXT,
    "timeline" TEXT,
    "nextSteps" TEXT,
    "narrativeReadiness" TEXT NOT NULL DEFAULT 'none',
    "narrativeReadinessNote" TEXT,
    "blockers" TEXT,
    "aiAutoReviewEnabled" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Project" ("aiAutoReviewEnabled", "blockers", "createdAt", "description", "figuresOfMerit", "hypothesis", "id", "narrativeReadiness", "narrativeReadinessNote", "nextSteps", "status", "timeline", "title", "updatedAt") SELECT "aiAutoReviewEnabled", "blockers", "createdAt", "description", "figuresOfMerit", "hypothesis", "id", "narrativeReadiness", "narrativeReadinessNote", "nextSteps", "status", "timeline", "title", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wandbRunId" TEXT,
    "wandbSourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "computeGpuHours" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "Run_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_wandbSourceId_fkey" FOREIGN KEY ("wandbSourceId") REFERENCES "WandbSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("computeGpuHours", "createdAt", "endedAt", "hypothesisId", "id", "name", "notes", "startedAt", "status", "updatedAt", "wandbRunId") SELECT "computeGpuHours", "createdAt", "endedAt", "hypothesisId", "id", "name", "notes", "startedAt", "status", "updatedAt", "wandbRunId" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WandbSource_projectId_entity_name_key" ON "WandbSource"("projectId", "entity", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RepoLink_projectId_url_key" ON "RepoLink"("projectId", "url");
