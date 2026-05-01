-- CreateTable
CREATE TABLE "Workhorse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "lastHeartbeat" DATETIME,
    "lastClaudeBeat" DATETIME,
    "configJson" TEXT,
    CONSTRAINT "Workhorse_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Workhorse_host_idx" ON "Workhorse"("host");

-- CreateIndex
CREATE UNIQUE INDEX "Workhorse_host_projectId_key" ON "Workhorse"("host", "projectId");
