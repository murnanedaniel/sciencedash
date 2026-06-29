import { prisma } from "@/lib/prisma";

/**
 * Normalize a git remote URL to a stable `host/org/repo` slug so the same repo
 * matches across machines and URL forms:
 *   git@github.com:Org/Repo.git      -> github.com/org/repo
 *   https://github.com/Org/Repo      -> github.com/org/repo
 *   ssh://git@gitlab.cern.ch/g/acorn -> gitlab.cern.ch/g/acorn
 */
export function normalizeRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = url.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^(https?|ssh|git):\/\//, ""); // strip protocol
  s = s.replace(/^[^@/]+@/, ""); // strip user@
  s = s.replace(/:(?!\/)/, "/"); // scp-style host:path -> host/path
  s = s.replace(/\.git$/, "").replace(/\/+$/, "");
  return s || null;
}

export type Resolution = {
  projectId: string | null;
  confident: boolean;
  candidates: { id: string; title: string }[];
};

/**
 * Resolve which project a session belongs to. Priority:
 *   1. git remote matches a project's repo link (robust, cross-machine).
 *   2. cwd is under a project's localPath (legacy fallback).
 *   3. otherwise: ranked candidates (repo-name / title match) — the hook
 *      surfaces these so the session can propose + confirm.
 */
export async function resolveProject(opts: {
  cwd?: string | null;
  gitRemote?: string | null;
}): Promise<Resolution> {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      title: true,
      localPath: true,
      repoLinks: { select: { url: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const wantRemote = normalizeRemote(opts.gitRemote);
  if (wantRemote) {
    const matches = projects.filter((p) =>
      p.repoLinks.some((r) => normalizeRemote(r.url) === wantRemote),
    );
    if (matches.length === 1) {
      return { projectId: matches[0].id, confident: true, candidates: [] };
    }
    if (matches.length > 1) {
      return {
        projectId: null,
        confident: false,
        candidates: matches.map((p) => ({ id: p.id, title: p.title })),
      };
    }
  }

  const cwd = opts.cwd || "";
  if (cwd) {
    let best: { id: string; len: number } | null = null;
    for (const p of projects) {
      const lp = p.localPath;
      if (!lp) continue;
      const prefix = lp.endsWith("/") ? lp : lp + "/";
      if (cwd === lp || cwd.startsWith(prefix)) {
        if (!best || lp.length > best.len) best = { id: p.id, len: lp.length };
      }
    }
    if (best) return { projectId: best.id, confident: true, candidates: [] };
  }

  // candidate proposal: projects whose repo basename or title mentions the cwd dir
  const base = (cwd.split("/").filter(Boolean).pop() || "").toLowerCase();
  const candidates: { id: string; title: string }[] = [];
  if (base.length >= 3) {
    for (const p of projects) {
      const repoNames = p.repoLinks.map(
        (r) => (normalizeRemote(r.url) || "").split("/").pop() || "",
      );
      if (repoNames.some((n) => n === base) || p.title.toLowerCase().includes(base)) {
        candidates.push({ id: p.id, title: p.title });
      }
    }
  }
  return { projectId: null, confident: false, candidates: candidates.slice(0, 5) };
}
