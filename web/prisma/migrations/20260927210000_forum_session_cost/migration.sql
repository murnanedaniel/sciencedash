-- Forum: track cumulative driver-side session cost so resumed turns record
-- only their own cost delta.
--
-- Hand-written and additive only. `prisma migrate dev` cannot be used on this
-- database: it sees the raw-SQL ThreadFTS virtual tables as drift and proposes
-- dropping them. Apply with `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "ForumParticipant" ADD COLUMN "sessionCostUsd" REAL NOT NULL DEFAULT 0;
