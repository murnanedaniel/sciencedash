-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verdict" TEXT NOT NULL DEFAULT 'pending',
    "computeBudgetGpuHours" REAL NOT NULL DEFAULT 10,
    "resolvedAt" DATETIME,
    CONSTRAINT "Hypothesis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wandbRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "computeGpuHours" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "Run_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMetricDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'higher',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "threshold" REAL,
    CONSTRAINT "ProjectMetricDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    CONSTRAINT "Metric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Metric_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ProjectMetricDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "path" TEXT NOT NULL,
    "caption" TEXT,
    "projectId" TEXT,
    "runId" TEXT,
    CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "rationale" TEXT,
    "projectId" TEXT,
    CONSTRAINT "Decision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "bodyMd" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "proposedPatchJson" TEXT,
    CONSTRAINT "CheckIn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "description" TEXT,
    "hypothesis" TEXT,
    "figuresOfMerit" TEXT,
    "timeline" TEXT,
    "nextSteps" TEXT,
    "githubRepoUrl" TEXT,
    "narrativeReadiness" TEXT NOT NULL DEFAULT 'none',
    "narrativeReadinessNote" TEXT,
    "blockers" TEXT,
    "aiAutoReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wandbEntity" TEXT,
    "wandbProject" TEXT
);
INSERT INTO "new_Project" ("blockers", "createdAt", "figuresOfMerit", "githubRepoUrl", "hypothesis", "id", "narrativeReadiness", "nextSteps", "status", "timeline", "title", "type", "updatedAt") SELECT "blockers", "createdAt", "figuresOfMerit", "githubRepoUrl", "hypothesis", "id", coalesce("narrativeReadiness", 'none') AS "narrativeReadiness", "nextSteps", "status", "timeline", "title", "type", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMetricDefinition_projectId_name_key" ON "ProjectMetricDefinition"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Metric_runId_definitionId_key" ON "Metric"("runId", "definitionId");
