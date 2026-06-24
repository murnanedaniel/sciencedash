/**
 * System prompt builder for the dashboard's web-native chat surface.
 *
 * Assembled fresh per request from:
 *   1. A short header that names this chat as "the brain" and sets the
 *      voice contract.
 *   2. `tools/chat-context/user_brief.md` (user-editable, on disk) — the
 *      persistent picture of who the user is, what hosts are bootstrapped,
 *      what the current priorities are.
 *   3. A compact dump of the user's active projects (id, title, status,
 *      nextSteps, blockers) so the chat can reach the right `projectId`
 *      without an extra MCP read on every turn.
 *
 * Keep the dynamic section short. The chat has MCP read tools available
 * (`query_entity`, `get_entity`) for everything else — better to teach
 * it to fetch on demand than to bloat every system prompt.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

const HEADER = `# ScienceDash Chat

You are the dashboard's chat brain. The user types into a single textarea on
the homepage and you act — you have the full ScienceDash MCP surface available
(\`mcp__sciencedash__*\` tools) and the user expects you to USE it, not just
describe what could be done.

## Voice contract

Be terse and decision-shaped. No preamble, no "Sure, I can help with that".
When you take an action that mutates state, state it in one line: "Spawned
sd-cmoxyz on perlmutter against ~/research/foo." Match the dashboard's tone.

## Autonomy posture

- The user has set "auto-fire with kill switch": fire \`dispatch_workhorse_session\`
  when the user asks for a workhorse, without asking for permission.
  If you got the wrong project / host / repo, they'll \`stop_all_workhorses\`.
- Default to ACTING. If the user says "spin up X on perlmutter", spawn it.
  If they say "what would happen if I…", explain without spawning.

## Useful patterns

- New project + workhorse in one turn:
  1. \`create_project(title=..., hypothesis=..., tags=[...])\` → returns new project id.
  2. \`dispatch_workhorse_session(projectId=<new id>, host="perlmutter", repo="~/research/<slug>", initialPrompt="<first task>")\` to fire a workhorse.
- Amending an existing project: \`query_entity(kind="project", filters={status:"active"})\` to find it, then \`update_entity\` or \`create_check_in\`.
- "What should I work on?" — read \`/today\`-shaped state via \`query_entity\` (projects, messages, runs) and surface the punch list.
`;

/**
 * Load user_brief.md from the repo. If missing, return a placeholder
 * so the prompt still functions on a clean install.
 */
async function loadUserBrief(): Promise<string> {
  const briefPath = join(process.cwd(), "..", "tools", "chat-context", "user_brief.md");
  try {
    return await readFile(briefPath, "utf-8");
  } catch {
    return "# User brief\n\n_(No user_brief.md yet — copy tools/chat-context/user_brief.example.md to user_brief.md and fill it in.)_\n";
  }
}

/**
 * Compact project table — id, title, status, plus the most actionable
 * fields. ~5 lines per project. Keeps the prompt fixed-size as long as
 * the active set stays small.
 */
async function loadProjectDigest(): Promise<string> {
  const projects = await prisma.project.findMany({
    where: { status: { in: ["idea", "active", "blocked"] } },
    select: {
      id: true,
      title: true,
      status: true,
      hypothesis: true,
      nextSteps: true,
      blockers: true,
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 40,
  });
  if (projects.length === 0) {
    return "# Active projects\n\n_(none yet)_\n";
  }
  const lines: string[] = ["# Active projects (id · title · status)"];
  for (const p of projects) {
    lines.push(`- \`${p.id}\` · **${p.title}** · ${p.status}`);
    if (p.hypothesis) lines.push(`    - hyp: ${truncate(p.hypothesis, 200)}`);
    if (p.nextSteps) lines.push(`    - next: ${truncate(p.nextSteps, 200)}`);
    if (p.blockers) lines.push(`    - blocked: ${truncate(p.blockers, 200)}`);
  }
  return lines.join("\n") + "\n";
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

export async function buildChatSystemPrompt(): Promise<string> {
  const [userBrief, projectDigest] = await Promise.all([
    loadUserBrief(),
    loadProjectDigest(),
  ]);
  return [HEADER, userBrief, projectDigest].join("\n");
}
