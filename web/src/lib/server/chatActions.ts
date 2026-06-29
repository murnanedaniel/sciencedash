"use server";

import { revalidatePath } from "next/cache";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/prisma";

const ROOTS_TO_SCAN = ["Research", "code", "src", "Projects", "projects"];

/**
 * Walk a small set of conventional directories under $HOME looking for a
 * git repo whose remote.origin.url matches one of the project's RepoLinks.
 * If found, persist localPath on the project.
 */
export async function autoDetectLocalPathAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { repoLinks: true },
  });
  if (!project) return;
  if (project.repoLinks.length === 0) return; // nothing to match against

  const home = os.homedir();
  const wantUrls = new Set(
    project.repoLinks.flatMap((r) => normaliseRepoUrlVariants(r.url)),
  );

  for (const rootName of ROOTS_TO_SCAN) {
    const root = path.join(home, rootName);
    const found = await scanForMatchingRepo(root, wantUrls, /*depth*/ 3);
    if (found) {
      await prisma.project.update({
        where: { id: projectId },
        data: { localPath: found },
      });
      revalidatePath(`/projects/${projectId}`);
      return;
    }
  }
  // No match — leave localPath null. UI will offer manual path entry.
}

export async function setLocalPathAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const raw = String(formData.get("localPath") ?? "").trim();
  if (!projectId) return;
  const localPath = raw === "" ? null : raw;
  if (localPath !== null && !path.isAbsolute(localPath)) {
    // We require absolute paths — relative paths break across cwds.
    return;
  }
  await prisma.project.update({
    where: { id: projectId },
    data: { localPath },
  });
  revalidatePath(`/projects/${projectId}`);
}

/* ------------------------- internal helpers ------------------------- */

function normaliseRepoUrlVariants(url: string): string[] {
  // Match git, ssh, and https forms of the same repo.
  // e.g. https://github.com/owner/repo.git ↔ git@github.com:owner/repo.git
  const out = new Set<string>();
  const trimmed = url.replace(/\.git$/, "").replace(/\/$/, "");
  out.add(trimmed);
  out.add(trimmed + ".git");
  const m = /^https?:\/\/([^\/]+)\/(.+)$/i.exec(trimmed);
  if (m) {
    out.add(`git@${m[1]}:${m[2]}`);
    out.add(`git@${m[1]}:${m[2]}.git`);
  }
  const m2 = /^git@([^:]+):(.+)$/i.exec(trimmed);
  if (m2) {
    out.add(`https://${m2[1]}/${m2[2]}`);
    out.add(`https://${m2[1]}/${m2[2]}.git`);
  }
  return [...out];
}

async function scanForMatchingRepo(
  root: string,
  wantUrls: Set<string>,
  depth: number,
): Promise<string | null> {
  if (depth < 0) return null;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const candidate = path.join(root, entry.name);
    const gitConfig = path.join(candidate, ".git", "config");
    try {
      const cfg = await fs.readFile(gitConfig, "utf-8");
      const m = /^\s*url\s*=\s*(.+)$/m.exec(cfg);
      if (m) {
        const url = m[1].trim();
        const variants = normaliseRepoUrlVariants(url);
        if (variants.some((v) => wantUrls.has(v))) {
          return candidate;
        }
      }
    } catch {
      // not a git repo — recurse into it
      const found = await scanForMatchingRepo(candidate, wantUrls, depth - 1);
      if (found) return found;
    }
  }
  return null;
}
