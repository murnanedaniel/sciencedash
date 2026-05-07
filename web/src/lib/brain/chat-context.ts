/**
 * CHAT_CONTEXT.md primer — rendered fresh each time the user pastes the
 * brain-chat bootstrap, so the chat Claude starts already-briefed on the
 * current state of programmes, projects, blockers, recent agent activity,
 * and prior chats.
 */

import { prisma } from "@/lib/prisma";

const TIER_RECENT_MESSAGES = 10;
const TIER_RECENT_BRAIN_CHATS = 3;

export async function buildBrainChatContext(): Promise<string> {
  const [programmes, projects, recentMessages, recentChats] = await Promise.all([
    prisma.programme.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        narrativeReadinessNote: true,
        _count: { select: { projects: true } },
      },
    }),
    prisma.project.findMany({
      where: { status: { in: ["active", "blocked"] } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        blockers: true,
        nextSteps: true,
        narrativeReadiness: true,
        brainLastHeartbeatAt: true,
        updatedAt: true,
        programme: { select: { name: true } },
      },
    }),
    prisma.agentMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: TIER_RECENT_MESSAGES,
      select: {
        createdAt: true,
        source: true,
        severity: true,
        body: true,
        readAt: true,
        project: { select: { id: true, title: true } },
      },
    }),
    prisma.brainChat.findMany({
      where: { summaryMd: { not: null } },
      orderBy: { createdAt: "desc" },
      take: TIER_RECENT_BRAIN_CHATS,
      select: {
        id: true,
        title: true,
        createdAt: true,
        summaryMd: true,
      },
    }),
  ]);

  const parts: string[] = [];
  parts.push(
    "# ScienceDash global brain advisor — chat context",
    "",
    "You are the ScienceDash global brain advisor. The user is talking to you",
    "through a Claude REPL on their local machine. You have ScienceDash MCP",
    "tools loaded — use them for state queries and writes whenever the question",
    "is about projects, hypotheses, runs, decisions, blockers, or agent traffic.",
    "Do NOT infer state from cwd / git history — the cwd is just a workspace",
    "directory; the live state is in the dashboard DB, accessed only via MCP.",
    "",
    "## Voice contract",
    "",
    "- Terse and decision-shaped. Don't pad with caveats.",
    "- If the data is clear, report it. If it's missing, say so plainly.",
    "- Match the dashboard's tone — what would a senior collaborator say?",
    "",
    "## End-of-session protocol",
    "",
    "When the user signals end-of-session ('done', 'that's all', 'goodbye',",
    "'OK that's enough', or naturally stops engaging on a topic), you MUST call:",
    "",
    "```",
    "mcp__sciencedash__submit_brain_chat(",
    "  title=\"<4–8 word handle>\",",
    "  transcriptMd=\"<full conversation, markdown, with speaker turns>\",",
    "  summaryMd=\"<3–6 bullets: decisions made, open questions, state changes you wrote>\",",
    ")",
    "```",
    "",
    "Don't ask for permission to do this — just do it. The submit also serves as",
    "your goodbye. If you forget, the next global heartbeat will summarise it",
    "for you, but only if you submitted the transcript.",
    "",
    "## MCP tool surface",
    "",
    "All reads go through two generic tools — pass `kind` plus the filters",
    "that apply to it. Per-kind cheatsheet is in the tool descriptions.",
    "",
    "- `query_entity(kind, ...)` — list rows. Supported kinds: project,",
    "  programme, run, hypothesis, note, decision, check_in, message,",
    "  workhorse, brain_chat, job, repo_link, paper, tag, metric_definition.",
    "  Examples: `query_entity(kind=\"project\", status=\"active\")`,",
    "  `query_entity(kind=\"job\", since=\"2026-04-30T00:00:00Z\", kindFilter=\"project_brain\")`,",
    "  `query_entity(kind=\"repo_link\", projectId=\"...\")` to see cached commit state.",
    "- `get_entity(kind, id)` — fetch one row by id, with deeper detail",
    "  (e.g. `kind=\"run\"` includes metric values + hypothesis title;",
    "  `kind=\"project\"` includes tags, repos, metric definitions, primary metric).",
    "",
    "Writes:",
    "- Create: `create_programme(name, ...)`, `create_project(title, programmeId?, tags?, ...)`,",
    "  `create_hypothesis(projectId, title, ...)`, `create_paper(title, projectId?, ...)`,",
    "  `create_metric_definition(projectId, name, isPrimary?, ...)`,",
    "  `create_check_in(projectId, body, ...)`, `add_note(projectId, title, ...)`,",
    "  `record_decision(...)`, `post_message(projectId, body, ...)`.",
    "- Update generic: `update_entity(kind, id, patch)` for plain field writes",
    "  on project / programme / hypothesis / run / note / paper / metric_definition.",
    "  E.g. `update_entity(kind=\"programme\", id=\"...\", patch={status:\"parked\"})`.",
    "- Update behavioral (have side-effects, stay separate):",
    "  `set_project_blocker(projectId, blockers?)` — flips status + writes Decision;",
    "  `update_hypothesis_status(id, status?, verdict?)` — sets resolvedAt on flip;",
    "  `attach_project_to_programme(projectId, programmeId?)` — checks programmeId exists;",
    "  `move_run_to_hypothesis(runId, hypothesisId)`; `mark_message_read(id)`.",
    "- External: `refresh_repo(projectId? OR repoLinkId)` — force-pull GitHub commit state.",
    "- Workhorse / chat: `dispatch_workhorse(...)`, `queue_directive(...)`,",
    "  `submit_brain_chat(title, transcriptMd, summaryMd?)`.",
    "",
    "## Skills",
    "",
    "Three workspace skills are available for common requests — invoke them",
    "when the user's intent matches their description:",
    "- `weekly-review` — past-7-day digest across active projects.",
    "- `triage-feed` — walk through unread agent messages, mark-read with rationale.",
    "- `health-check` — flag overspent budgets, stale repos, dead workhorses,",
    "  missing primary metrics across the active portfolio.",
    "",
    "Skills are recipes — they tell you which MCP tools to call and in what order.",
    "Compose them with the atoms above when the request doesn't fit a skill.",
    "",
  );

  parts.push("## Programmes", "");
  if (programmes.length === 0) {
    parts.push("(none)", "");
  } else {
    for (const pg of programmes) {
      parts.push(
        `- **${pg.name}** (${pg.status}) · ${pg._count.projects} project(s)` +
          (pg.narrativeReadinessNote ? ` — ${pg.narrativeReadinessNote}` : ""),
      );
    }
    parts.push("");
  }

  parts.push("## Projects (active + blocked)", "");
  if (projects.length === 0) {
    parts.push("(none)", "");
  } else {
    for (const p of projects) {
      const programme = p.programme?.name ? ` [programme: ${p.programme.name}]` : "";
      const heartbeat = p.brainLastHeartbeatAt
        ? `last brain ${p.brainLastHeartbeatAt.toISOString()}`
        : "no brain heartbeat yet";
      parts.push(
        `### ${p.title}${programme}`,
        `- id: \`${p.id}\``,
        `- status: ${p.status}` +
          (p.status === "blocked" && p.blockers
            ? ` — **blocked on:** ${p.blockers}`
            : ""),
        `- narrative readiness: ${p.narrativeReadiness}`,
        `- ${heartbeat}`,
      );
      if (p.nextSteps) {
        const trimmed = p.nextSteps.trim();
        const compressed =
          trimmed.length > 400 ? trimmed.slice(0, 400) + "…" : trimmed;
        parts.push(`- next steps:`, ...compressed.split(/\r?\n/).map((l) => `  > ${l}`));
      }
      parts.push("");
    }
  }

  parts.push("## Recent agent messages (newest first)", "");
  if (recentMessages.length === 0) {
    parts.push("(none)", "");
  } else {
    for (const m of recentMessages) {
      const unread = m.readAt === null ? " · UNREAD" : "";
      const proj = m.project?.title ?? "(no project)";
      const first = m.body.split(/\r?\n/)[0]?.trim() ?? "";
      const compact = first.length > 200 ? first.slice(0, 200) + "…" : first;
      parts.push(
        `- ${m.createdAt.toISOString()} · ${proj} · ${m.source} · ${m.severity}${unread}`,
        `  > ${compact}`,
      );
    }
    parts.push("");
  }

  parts.push("## Recent brain chats (your prior sessions with the user)", "");
  if (recentChats.length === 0) {
    parts.push(
      "(none yet — this is the first persisted chat, or earlier ones haven't been summarised)",
      "",
    );
  } else {
    for (const c of recentChats) {
      parts.push(`### ${c.title} · ${c.createdAt.toISOString()} · id \`${c.id}\``);
      if (c.summaryMd) {
        parts.push(c.summaryMd.trim());
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}
