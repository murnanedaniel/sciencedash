"use server";

import { revalidatePath } from "next/cache";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/prisma";
import { buildMcpServerConfig } from "@/lib/brain/mcp-client";

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

/**
 * Write a `.mcp.json` at <localPath>/.mcp.json so subsequent `claude` runs
 * in that dir auto-load the ScienceDash MCP. Idempotent.
 */
export async function persistMcpConfigAction(formData: FormData): Promise<{ ok: boolean; error?: string; written?: string } | void> {
  const projectId = String(formData.get("projectId") ?? "");
  const dashboardUrl = String(formData.get("dashboardUrl") ?? "http://localhost:3000");
  if (!projectId) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { localPath: true },
  });
  if (!project?.localPath) return;

  const token = process.env.SCIENCEDASH_AUTH_TOKEN;
  if (!token) {
    // Without the token the spawned Claude would 401 against the proxy
    // every MCP call. Surface the misconfig instead of writing a broken
    // .mcp.json that fails opaquely later.
    return {
      ok: false,
      error:
        "SCIENCEDASH_AUTH_TOKEN missing from server env — can't write a working .mcp.json",
    };
  }
  const mcpConfig = {
    mcpServers: {
      sciencedash: {
        ...buildMcpServerConfig({ dashboardUrl, token }),
        // jsonargparse-friendly defaults: pass projectId via env so MCP tool
        // calls can default the projectId argument.
        env: { SCIENCEDASH_PROJECT_ID: projectId },
      },
    },
  };
  const target = path.join(project.localPath, ".mcp.json");
  await fs.writeFile(target, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");

  // Also write a chat-context primer that gets passed as
  // --append-system-prompt so Claude knows about ScienceDash MCP and
  // doesn't infer "this project" from the cwd's git history.
  const sdDir = path.join(project.localPath, ".sciencedash");
  await fs.mkdir(sdDir, { recursive: true });
  const contextMd = buildChatContext(projectId);
  await fs.writeFile(path.join(sdDir, "CHAT_CONTEXT.md"), contextMd, "utf-8");

  // Make sure both files are gitignored.
  await ensureGitignored(project.localPath, ".mcp.json");
  await ensureGitignored(project.localPath, ".sciencedash/");

  revalidatePath(`/projects/${projectId}`);
}

function buildChatContext(projectId: string): string {
  return `# ScienceDash chat-with-project context

You are in a ScienceDash project workspace. The user is chatting with you
about a research project that has live state in the ScienceDash dashboard
DB — runs, hypotheses, decisions, literature notes, agent messages.

## Default behaviour

When the user asks about **the project's state, hypotheses, runs,
decisions, recent literature, brain output, or workhorses**, use the
\`mcp__sciencedash__*\` tools — these read the live DB. Do NOT infer
project state from git history, file contents, or directory structure
unless the user explicitly asks about the codebase.

When the user asks about **the codebase, code structure, or asks you to
edit files**, use Bash / Read / Write / Edit / Glob / Grep as you
normally would.

## This project's id

\`${projectId}\`

Pass this as the \`projectId\` argument to MCP tools. Examples:

- \`mcp__sciencedash__get_project(id="${projectId}")\` — full project state
- \`mcp__sciencedash__list_runs(projectId="${projectId}")\` — runs across hypotheses
- \`mcp__sciencedash__list_hypotheses(projectId="${projectId}")\`
- \`mcp__sciencedash__list_notes(projectId="${projectId}", kind="paper")\` — literature
- \`mcp__sciencedash__list_decisions(projectId="${projectId}")\`
- \`mcp__sciencedash__list_messages(projectId="${projectId}", unreadOnly=true)\` — agent feed
- \`mcp__sciencedash__create_check_in(projectId="${projectId}", body=...)\` — log progress
- \`mcp__sciencedash__record_decision(projectId="${projectId}", kind=..., subjectType=..., subjectId=..., rationale=...)\`
- \`mcp__sciencedash__add_note(projectId="${projectId}", kind="paper", title=..., arxivId=..., takeaway=...)\`

## Voice contract

When summarising for the user, be **terse and decision-shaped** — match
the dashboard's tone. Don't pad with caveats; if the data is clear,
report it. If it's missing, say so plainly.
`;
}

/**
 * Append a pattern to .gitignore (creating the file if missing) iff it
 * isn't already present as a non-comment line. Idempotent.
 */
async function ensureGitignored(repoRoot: string, pattern: string): Promise<void> {
  const gitignore = path.join(repoRoot, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(gitignore, "utf-8");
  } catch {
    // file doesn't exist — we'll create it
  }
  const present = current
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === pattern || l === `/${pattern}`);
  if (present) return;
  const sep = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  await fs.writeFile(
    gitignore,
    current + sep + (current.length === 0 ? "" : "\n") + `# ScienceDash\n${pattern}\n`,
    "utf-8",
  );
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
