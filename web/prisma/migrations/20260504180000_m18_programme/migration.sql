-- m18: Programme as a first-class organisational layer above Project.
-- One Project belongs to at most one Programme via nullable FK; deleting
-- a Programme detaches its children (onDelete: SET NULL), doesn't cascade.

CREATE TABLE "Programme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetVenues" TEXT,
    "figuresOfMerit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "narrativeReadinessNote" TEXT
);

CREATE UNIQUE INDEX "Programme_name_key" ON "Programme"("name");

ALTER TABLE "Project" ADD COLUMN "programmeId" TEXT REFERENCES "Programme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Project_programmeId_idx" ON "Project"("programmeId");
