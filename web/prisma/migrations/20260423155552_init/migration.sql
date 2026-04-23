-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "hypothesis" TEXT,
    "figuresOfMerit" TEXT,
    "timeline" TEXT,
    "nextSteps" TEXT,
    "githubRepoUrl" TEXT,
    "narrativeReadiness" TEXT,
    "blockers" TEXT
);
