import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const dynamic = "force-dynamic";

const REPO_ROOT = path.join(os.homedir(), "Research", "ScienceDash");
const LAST_DEPLOY_FILE = path.join(os.homedir(), ".sciencedash", "last-deploy");
const REPO_SLUG = "murnanedaniel/ScienceDash";

type CiStatus = "passed" | "pending" | "failed" | "no-runs" | "error";

type StatusResult = {
  /** SHA currently checked out in the repo on disk (live HEAD). */
  currentSha: string | null;
  /** Most recent successful auto-deploy. Null until the timer's run once. */
  lastDeploy: { sha: string; at: string } | null;
  /** CI status of the SHA at origin/main — what the auto-deploy gates on. */
  ciStatus: CiStatus;
  /** SHA at origin/main, fetched fresh on each call. May be ahead of currentSha. */
  remoteSha: string | null;
  /** True iff the remote SHA differs from the on-disk SHA — there's a deploy waiting. */
  pending: boolean;
};

export async function GET(): Promise<NextResponse<StatusResult>> {
  const [currentSha, lastDeploy, remoteSha] = await Promise.all([
    readCurrentSha(),
    readLastDeploy(),
    fetchRemoteSha(),
  ]);

  const ciTargetSha = remoteSha ?? currentSha;
  const ciStatus = ciTargetSha ? await fetchCiStatus(ciTargetSha) : "error";

  return NextResponse.json({
    currentSha,
    lastDeploy,
    ciStatus,
    remoteSha,
    pending:
      currentSha !== null && remoteSha !== null && currentSha !== remoteSha,
  });
}

async function readCurrentSha(): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readLastDeploy(): Promise<{ sha: string; at: string } | null> {
  try {
    const raw = (await fs.readFile(LAST_DEPLOY_FILE, "utf-8")).trim();
    const [sha, ...rest] = raw.split(/\s+/);
    if (!sha) return null;
    return { sha, at: rest.join(" ") };
  } catch {
    return null;
  }
}

/**
 * Refresh-and-resolve `origin/main`. We do `git fetch` so the answer is
 * up-to-date even between auto-deploy ticks; the cost is one network
 * roundtrip per /settings render. The fetch is best-effort — if it
 * fails (offline, auth issue) we fall back to the cached remote ref.
 */
async function fetchRemoteSha(): Promise<string | null> {
  await execFileP("git", ["fetch", "origin", "main", "--quiet"], {
    cwd: REPO_ROOT,
  }).catch(() => null);
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "origin/main"], {
      cwd: REPO_ROOT,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function fetchCiStatus(sha: string): Promise<CiStatus> {
  // gh CLI uses the user's stored credentials at ~/.config/gh — set up
  // once via `gh auth login`. The query path matches what deploy.sh
  // uses so the widget shows what the gate sees.
  try {
    const { stdout } = await execFileP("gh", [
      "api",
      `repos/${REPO_SLUG}/commits/${sha}/check-runs?per_page=100`,
      "--jq",
      // Same expression as in deploy.sh — keep them in sync.
      'if (.check_runs | length) == 0 then "no-runs"' +
        ' elif (.check_runs | all(.status == "completed")) then' +
        '   if (.check_runs | all(.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral")) then "passed" else "failed" end' +
        ' else "pending" end',
    ]);
    const s = stdout.trim();
    if (
      s === "passed" ||
      s === "pending" ||
      s === "failed" ||
      s === "no-runs"
    ) {
      return s;
    }
    return "error";
  } catch {
    return "error";
  }
}
