-- Additive only: preserve existing tmux workhorses and raw-SQL ThreadFTS tables.
-- SQLite stores enums as TEXT; JobKind and severity additions need no DDL.
CREATE TABLE "Bridge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "envId" TEXT,
    "node" TEXT,
    "jobId" TEXT,
    "rcAlive" BOOLEAN NOT NULL DEFAULT false,
    "claudeVersion" TEXT,
    "liveSessions" TEXT NOT NULL DEFAULT '[]',
    "lastBeat" DATETIME,
    "downAlertedAt" DATETIME,
    "configJson" TEXT
);
CREATE UNIQUE INDEX "Bridge_name_key" ON "Bridge"("name");

ALTER TABLE "Workhorse" ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'tmux';
ALTER TABLE "Workhorse" ADD COLUMN "bridgeName" TEXT;
ALTER TABLE "Workhorse" ADD COLUMN "rcSessionId" TEXT;
ALTER TABLE "Workhorse" ADD COLUMN "rcEnvId" TEXT;
ALTER TABLE "Workhorse" ADD COLUMN "rcState" TEXT;
ALTER TABLE "Workhorse" ADD COLUMN "lastWakeAt" DATETIME;
ALTER TABLE "Workhorse" ADD COLUMN "wakeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workhorse" ADD COLUMN "recreateRequestedAt" DATETIME;
