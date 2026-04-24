import { prisma } from "@/lib/prisma";

/**
 * For every RepoLink, fetch the last commit on the default branch and write
 * the sha/date onto the RepoLink row. We also log a JobRun per link so the
 * Settings page sees a freshness trail.
 */
export async function pullGithub(): Promise<{
  updated: number;
  scanned: number;
}> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");

  const links = await prisma.repoLink.findMany();
  let updated = 0;
  let scanned = 0;
  for (const link of links) {
    scanned++;
    const parsed = parseGithubUrl(link.url);
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

    await prisma.repoLink.update({
      where: { id: link.id },
      data: {
        cachedLastCommitSha: sha,
        cachedLastCommitAt: at,
      },
    });
    await prisma.jobRun.create({
      data: {
        kind: "github_pull",
        projectId: link.projectId,
        ok: true,
        startedAt: new Date(),
        endedAt: new Date(),
        payloadJson: JSON.stringify({
          repoLinkId: link.id,
          url: link.url,
          sha,
          at: at.toISOString(),
        }),
      },
    });
    updated++;
  }
  return { updated, scanned };
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/\s]+?)(?:\.git|\/)?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}
