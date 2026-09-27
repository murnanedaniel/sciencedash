-- Forum: multi-party conversations between the user and two or more AI
-- participants (Claude via the Agent SDK, Codex via `codex exec`).
--
-- Hand-written and additive only. `prisma migrate dev` cannot be used on this
-- database: it sees the raw-SQL ThreadFTS virtual tables as drift and proposes
-- dropping them. Apply with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "Forum" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "turnBudget" INTEGER NOT NULL DEFAULT 6,
    "turnsSpent" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "endedAt" DATETIME,
    CONSTRAINT "Forum_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "forumId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT '',
    "sessionRef" TEXT,
    "seat" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ForumParticipant_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "Forum" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "forumId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idx" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "eventsJson" TEXT,
    "costUsd" REAL,
    "addressed" TEXT,
    CONSTRAINT "ForumMessage_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "Forum" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Forum_projectId_idx" ON "Forum"("projectId");

-- CreateIndex
CREATE INDEX "Forum_updatedAt_idx" ON "Forum"("updatedAt");

-- CreateIndex
CREATE INDEX "ForumParticipant_forumId_idx" ON "ForumParticipant"("forumId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumParticipant_forumId_handle_key" ON "ForumParticipant"("forumId", "handle");

-- CreateIndex
CREATE INDEX "ForumMessage_forumId_createdAt_idx" ON "ForumMessage"("forumId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForumMessage_forumId_idx_key" ON "ForumMessage"("forumId", "idx");
