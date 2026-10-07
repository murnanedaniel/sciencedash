-- Retire the old transport before rebuilding the RC-only table.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
DELETE FROM "Workhorse" WHERE "transport" != 'rc';
CREATE TABLE "new_Workhorse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "bridgeName" TEXT NOT NULL,
    "rcSessionId" TEXT NOT NULL,
    "rcEnvId" TEXT,
    "rcState" TEXT,
    "registeredAt" DATETIME,
    "lastWakeAt" DATETIME,
    "wakeCount" INTEGER NOT NULL DEFAULT 0,
    "recreateRequestedAt" DATETIME,
    "lastTickAt" DATETIME,
    "repo" TEXT,
    CONSTRAINT "Workhorse_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Workhorse" ("id", "createdAt", "projectId", "bridgeName", "rcSessionId", "rcEnvId", "rcState", "registeredAt", "lastWakeAt", "wakeCount", "recreateRequestedAt", "repo")
SELECT "id", "createdAt", "projectId", COALESCE("bridgeName", "host"), "rcSessionId", "rcEnvId", "rcState", NULL, "lastWakeAt", "wakeCount", "recreateRequestedAt",
    CASE WHEN json_valid("configJson") THEN CASE WHEN json_type("configJson", '$.repo') = 'text' THEN json_extract("configJson", '$.repo') END END
FROM "Workhorse";
DROP TABLE "Workhorse";
ALTER TABLE "new_Workhorse" RENAME TO "Workhorse";
CREATE UNIQUE INDEX "Workhorse_projectId_bridgeName_key" ON "Workhorse"("projectId", "bridgeName");
CREATE INDEX "Workhorse_bridgeName_idx" ON "Workhorse"("bridgeName");
CREATE INDEX "Workhorse_projectId_idx" ON "Workhorse"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
