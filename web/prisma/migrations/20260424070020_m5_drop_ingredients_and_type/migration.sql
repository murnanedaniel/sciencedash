/*
  Warnings:

  - You are about to drop the `HypothesisIngredient` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Ingredient` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `type` on the `Project` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Ingredient_category_name_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "HypothesisIngredient";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Ingredient";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "description" TEXT,
    "hypothesis" TEXT,
    "figuresOfMerit" TEXT,
    "timeline" TEXT,
    "nextSteps" TEXT,
    "githubRepoUrl" TEXT,
    "narrativeReadiness" TEXT NOT NULL DEFAULT 'none',
    "narrativeReadinessNote" TEXT,
    "blockers" TEXT,
    "aiAutoReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "wandbEntity" TEXT,
    "wandbProject" TEXT
);
INSERT INTO "new_Project" ("aiAutoReviewEnabled", "blockers", "createdAt", "description", "figuresOfMerit", "githubRepoUrl", "hypothesis", "id", "narrativeReadiness", "narrativeReadinessNote", "nextSteps", "status", "timeline", "title", "updatedAt", "wandbEntity", "wandbProject") SELECT "aiAutoReviewEnabled", "blockers", "createdAt", "description", "figuresOfMerit", "githubRepoUrl", "hypothesis", "id", "narrativeReadiness", "narrativeReadinessNote", "nextSteps", "status", "timeline", "title", "updatedAt", "wandbEntity", "wandbProject" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
