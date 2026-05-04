-- m17: per-project tempo overrides for the autonomy loops.
-- Null falls back to the worker's global default. 0 means paused.
ALTER TABLE "Project" ADD COLUMN "brainIntervalSec" INTEGER;
ALTER TABLE "Project" ADD COLUMN "workhorseIntervalSec" INTEGER;
