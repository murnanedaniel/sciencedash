-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'routine';

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN "evidenceIdsJson" TEXT;
