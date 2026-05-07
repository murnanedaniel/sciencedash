import { prisma } from "@/lib/prisma";

/**
 * Fetch the last commit on a single RepoLink's default branch and write
 * the sha/date back. Also logs a JobRun so the Settings page sees a
 * freshness trail. Returns null when the URL doesn't parse, the GH API
 * call fails, or the repo has no commits.
 *
 * Pulled out as a standalone so it can be invoked on-demand from the
 * MCP `refresh_repo` tool — not just from the background worker's
 * batch sweep.
 */
export async function pullOneRepoLink(
  linkId: string,
): Promise<{
  ok: boolean;
  sha?: string;
  at?: Date;
  error?: string;
} | null> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return { ok: false, error: "GITHUB_PAT not set" };

  const link = await prisma.repoLink.findUnique({ where: { id: linkId } });
  if (!link) return null;

  const parsed = parseGithubUrl(link.url);
  if (!parsed) return { ok: false, error: `couldn't parse owner/repo from ${link.url}` };
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
  if (!resp.ok) {
    return { ok: false, error: `github api ${resp.status}: ${await resp.text().catch(() => "")}`.slice(0, 300) };
  }
  const arr = (await resp.json()) as Array<{
    sha: string;
    commit: { author: { date: string } };
  }>;
  if (!Array.isArray(arr) || arr.length === 0) {
    return { ok: false, error: "no commits returned" };
  }
  const sha = arr[0]!.sha;
  const at = new Date(arr[0]!.commit.author.date);

  await prisma.repoLink.update({
    where: { id: link.id },
    data: { cachedLastCommitSha: sha, cachedLastCommitAt: at },
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
  return { ok: true, sha, at };
}

/**
 * For every RepoLink, fetch the last commit on the default branch and
 * write the sha/date back. Used by the background worker's tick.
 */
export async function pullGithub(): Promise<{
  updated: number;
  scanned: number;
}> {
  const links = await prisma.repoLink.findMany({ select: { id: true } });
  let updated = 0;
  let scanned = 0;
  for (const link of links) {
    scanned++;
    const result = await pullOneRepoLink(link.id);
    if (result?.ok) updated++;
  }
  return { updated, scanned };
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/\s]+?)(?:\.git|\/)?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}
