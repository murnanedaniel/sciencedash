-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "body" TEXT NOT NULL,
    "payloadJson" TEXT,
    "readAt" DATETIME,
    CONSTRAINT "AgentMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentMessage_projectId_createdAt_idx" ON "AgentMessage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_projectId_readAt_idx" ON "AgentMessage"("projectId", "readAt");
