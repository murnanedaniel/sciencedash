-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "cwd" TEXT NOT NULL,
    "title" TEXT,
    "projectId" TEXT,
    "firstAt" DATETIME,
    "lastAt" DATETIME,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "bodyText" TEXT NOT NULL DEFAULT '',
    "shippedLines" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Thread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "toolName" TEXT,
    "at" DATETIME,
    CONSTRAINT "Turn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Thread_sessionId_key" ON "Thread"("sessionId");

-- CreateIndex
CREATE INDEX "Thread_projectId_idx" ON "Thread"("projectId");

-- CreateIndex
CREATE INDEX "Thread_machine_idx" ON "Thread"("machine");

-- CreateIndex
CREATE INDEX "Thread_lastAt_idx" ON "Thread"("lastAt");

-- CreateIndex
CREATE INDEX "Turn_threadId_idx" ON "Turn"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_threadId_idx_key" ON "Turn"("threadId", "idx");

-- Full-text search over ingested threads (Prisma can't model FTS5, so this is
-- hand-written). Standalone FTS5 table keyed by threadId (UNINDEXED = stored +
-- returned, not tokenized). unicode61 + remove_diacritics fixes the accented /
-- case-folding search gap. Kept in sync with Thread via triggers below.
-- NOTE: future `prisma migrate dev` will see ThreadFTS as drift (it's not in
-- schema.prisma); use `prisma migrate deploy` to apply migrations.
CREATE VIRTUAL TABLE "ThreadFTS" USING fts5(
    threadId UNINDEXED,
    title,
    bodyText,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- FTS rows are keyed by Thread's integer rowid (FTS5 delete-by-rowid is the
-- canonical, reliable form; deleting by a content column flaps on UPDATE).
CREATE TRIGGER "Thread_fts_ai" AFTER INSERT ON "Thread" BEGIN
  INSERT INTO "ThreadFTS"(rowid, threadId, title, bodyText)
  VALUES (new."rowid", new."id", new."title", new."bodyText");
END;

CREATE TRIGGER "Thread_fts_ad" AFTER DELETE ON "Thread" BEGIN
  DELETE FROM "ThreadFTS" WHERE rowid = old."rowid";
END;

CREATE TRIGGER "Thread_fts_au" AFTER UPDATE ON "Thread" BEGIN
  DELETE FROM "ThreadFTS" WHERE rowid = old."rowid";
  INSERT INTO "ThreadFTS"(rowid, threadId, title, bodyText)
  VALUES (new."rowid", new."id", new."title", new."bodyText");
END;
