-- DropIndex
DROP INDEX "Workhorse_host_projectId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Workhorse_host_sessionName_key" ON "Workhorse"("host", "sessionName");

-- CreateIndex
CREATE INDEX "Workhorse_projectId_idx" ON "Workhorse"("projectId");
