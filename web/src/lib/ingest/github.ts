import { prisma } from "@/lib/prisma";

/**
 * For each project with a githubRepoUrl, fetch the last commit on the default
 * branch and update lastCommitSha / lastCommitAt / staleAt on the Repo row.
 *
 * We create the Repo row lazily on first pull so existing projects don't need
 * a backfill.
 */
export async function pullGithub(): Promise<{
  updated: number;
  scanned: number;
}> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");

  const projects = await prisma.project.findMany({
    where: { githubRepoUrl: { not: null } },
  });
  let updated = 0;
  let scanned = 0;
  for (const p of projects) {
    scanned++;
    const parsed = parseGithubUrl(p.githubRepoUrl ?? "");
    if (!parsed) continue;
    const { owner, repo } = parsed;
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          authorization: `Bearer ${pat}`,
        },
      },
    );
    if (!resp.ok) continue;
    const arr = (await resp.json()) as Array<{
      sha: string;
      commit: { author: { date: string } };
    }>;
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const sha = arr[0]!.sha;
    const at = new Date(arr[0]!.commit.author.date);
    const staleAt = new Date(at.getTime() + 14 * 24 * 60 * 60 * 1000);
    updated++;
    // We don't have a Repo model with projectId FK; store the cache as a JobRun
    // payload keyed by projectId so /settings can surface freshness without a
    // schema migration.
    await prisma.jobRun.create({
      data: {
        kind: "github_pull",
        projectId: p.id,
        ok: true,
        startedAt: new Date(),
        endedAt: new Date(),
        payloadJson: JSON.stringify({
          sha,
          at: at.toISOString(),
          staleAt: staleAt.toISOString(),
          url: p.githubRepoUrl,
        }),
      },
    });
  }
  return { updated, scanned };
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/\s]+?)(?:\.git|\/)?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}
