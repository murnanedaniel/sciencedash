/**
 * Read tools — non-mutating queries against the ScienceDash DB.
 *
 * Tone of descriptions: imperative, scientific. Claude reads these to
 * decide when to invoke; vague descriptions = wasted tool calls.
 */

import { prisma } from "@/lib/prisma";
import {
  jsonResult,
  optInt,
  optString,
  requireString,
} from "@/lib/mcp/server";
import type { ToolDefinition } from "@/lib/mcp/types";

const STATUS_VALUES = ["idea", "active", "blocked", "shipped", "parked"] as const;
const NOTE_KIND_VALUES = ["paper", "book", "talk", "thread", "other"] as const;

const listProjects: ToolDefinition = {
  name: "list_projects",
  description:
    "List ScienceDash projects, optionally filtered by status. Returns id, title, status, updatedAt, and tag names.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: STATUS_VALUES,
        description: "Filter to a single project status.",
      },
      limit: {
        type: "number",
        description: "Max projects to return (default 50).",
      },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const status = optString(args, "status") as (typeof STATUS_VALUES)[number] | undefined;
    const limit = optInt(args, "limit") ?? 50;
    const projects = await prisma.project.findMany({
      where: status ? { status } : undefined,
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { tags: { select: { name: true } } },
    });
    return jsonResult(
      projects.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        updatedAt: p.updatedAt,
        tags: p.tags.map((t) => t.name),
      })),
    );
  },
};

const getProject: ToolDefinition = {
  name: "get_project",
  description:
    "Fetch a single project's full state: title, status, hypothesis (text), description, primary metric, figures of merit, tags, narrative readiness, blockers, and counts of recent activity (runs, decisions, check-ins, notes).",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Project id." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args) {
    const id = requireString(args, "id");
    const p = await prisma.project.findUnique({
      where: { id },
      include: {
        tags: { select: { name: true } },
        metricDefinitions: true,
        repoLinks: true,
        wandbSources: true,
        _count: {
          select: { hypotheses: true, decisions: true, checkIns: true, notes: true, papers: true },
        },
      },
    });
    if (!p) throw new Error(`project not found: ${id}`);
    const primary = p.metricDefinitions.find((m) => m.isPrimary) ?? null;
    return jsonResult({
      id: p.id,
      title: p.title,
      status: p.status,
      description: p.description,
      hypothesis: p.hypothesis,
      figuresOfMerit: p.figuresOfMerit,
      timeline: p.timeline,
      nextSteps: p.nextSteps,
      narrativeReadiness: p.narrativeReadiness,
      narrativeReadinessNote: p.narrativeReadinessNote,
      blockers: p.blockers,
      tags: p.tags.map((t) => t.name),
      primaryMetric: primary
        ? { name: primary.name, unit: primary.unit, direction: primary.direction, threshold: primary.threshold }
        : null,
      metricDefinitions: p.metricDefinitions.map((m) => ({
        name: m.name,
        unit: m.unit,
        direction: m.direction,
        isPrimary: m.isPrimary,
        threshold: m.threshold,
      })),
      repoLinks: p.repoLinks.map((r) => ({ url: r.url, label: r.label })),
      wandbSources: p.wandbSources.map((w) => ({ entity: w.entity, name: w.name })),
      counts: p._count,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
    });
  },
};

const listRuns: ToolDefinition = {
  name: "list_runs",
  description:
    "List runs across all hypotheses of a project, newest first. Returns id, name, status, wandbRunId, startedAt, endedAt, computeGpuHours, and the hypothesis title.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      since: { type: "string", description: "ISO-8601 timestamp; only runs created after this." },
      limit: { type: "number", description: "Max runs (default 50)." },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const since = optString(args, "since");
    const limit = optInt(args, "limit") ?? 50;
    const runs = await prisma.run.findMany({
      where: {
        hypothesis: { projectId },
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { hypothesis: { select: { title: true } } },
    });
    return jsonResult(
      runs.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        wandbRunId: r.wandbRunId,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        computeGpuHours: r.computeGpuHours,
        hypothesisTitle: r.hypothesis.title,
        notes: r.notes,
      })),
    );
  },
};

const summariseRun: ToolDefinition = {
  name: "summarise_run",
  description:
    "Fetch a single run's full state including all logged metrics (name, value, direction, unit). Use this when you need to know whether a run hit its targets.",
  inputSchema: {
    type: "object",
    properties: { runId: { type: "string" } },
    required: ["runId"],
    additionalProperties: false,
  },
  async handler(args) {
    const runId = requireString(args, "runId");
    const r = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        hypothesis: { select: { id: true, title: true, projectId: true } },
        metrics: { include: { definition: true } },
        wandbSource: true,
      },
    });
    if (!r) throw new Error(`run not found: ${runId}`);
    return jsonResult({
      id: r.id,
      name: r.name,
      status: r.status,
      wandbRunId: r.wandbRunId,
      wandbSource: r.wandbSource ? { entity: r.wandbSource.entity, name: r.wandbSource.name } : null,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      computeGpuHours: r.computeGpuHours,
      notes: r.notes,
      hypothesis: r.hypothesis,
      metrics: r.metrics.map((m) => ({
        name: m.definition.name,
        value: m.value,
        unit: m.definition.unit,
        direction: m.definition.direction,
        threshold: m.definition.threshold,
      })),
    });
  },
};

const listNotes: ToolDefinition = {
  name: "list_notes",
  description:
    "List notes (papers, books, talks, threads, observations) linked to a project. Use kind=paper to get the literature reading list.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      kind: {
        type: "string",
        enum: NOTE_KIND_VALUES,
        description: "Filter to a single note kind.",
      },
      limit: { type: "number" },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const kind = optString(args, "kind") as (typeof NOTE_KIND_VALUES)[number] | undefined;
    const limit = optInt(args, "limit") ?? 50;
    const links = await prisma.noteProject.findMany({
      where: { projectId, ...(kind ? { note: { kind } } : {}) },
      orderBy: { note: { createdAt: "desc" } },
      take: limit,
      include: { note: true },
    });
    return jsonResult(
      links.map((l) => ({
        id: l.note.id,
        kind: l.note.kind,
        title: l.note.title,
        authors: l.note.authors,
        url: l.note.url,
        arxivId: l.note.arxivId,
        takeaway: l.note.takeaway,
        summaryMd: l.note.summaryMd,
        createdAt: l.note.createdAt,
      })),
    );
  },
};

const listDecisions: ToolDefinition = {
  name: "list_decisions",
  description:
    "List Decision rows for a project, newest first. Each Decision is a deliberate action recorded by the user or by an agent (promote, park, narrow, spawn_paper, resolve, retire, budget_escalate, paper_status_change, ai_patch_applied, other).",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      kind: { type: "string", description: "Filter to a single DecisionKind value." },
      limit: { type: "number" },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const kind = optString(args, "kind");
    const limit = optInt(args, "limit") ?? 50;
    const decisions = await prisma.decision.findMany({
      where: { projectId, ...(kind ? { kind: kind as never } : {}) },
      orderBy: { at: "desc" },
      take: limit,
    });
    return jsonResult(decisions);
  },
};

const listCheckIns: ToolDefinition = {
  name: "list_check_ins",
  description:
    "List CheckIn rows for a project, newest first. Each CheckIn is a short prose status update; sources include 'manual', agent ids, and 'ai_review'.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      since: { type: "string", description: "ISO-8601 timestamp." },
      limit: { type: "number" },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const since = optString(args, "since");
    const limit = optInt(args, "limit") ?? 50;
    const checkIns = await prisma.checkIn.findMany({
      where: {
        projectId,
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return jsonResult(
      checkIns.map((c) => ({
        id: c.id,
        bodyMd: c.bodyMd,
        scope: c.scope,
        source: c.source,
        createdAt: c.createdAt,
        proposedPatchJson: c.proposedPatchJson,
      })),
    );
  },
};

const listHypotheses: ToolDefinition = {
  name: "list_hypotheses",
  description:
    "List hypotheses for a project. Each has title, statement, status (active/paused/resolved), verdict (pending/supported/refuted/abandoned/spawned_paper), compute budget in GPU-hours, and run count.",
  inputSchema: {
    type: "object",
    properties: { projectId: { type: "string" } },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const hyps = await prisma.hypothesis.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { runs: true } } },
    });
    return jsonResult(
      hyps.map((h) => ({
        id: h.id,
        title: h.title,
        statement: h.statement,
        status: h.status,
        verdict: h.verdict,
        computeBudgetGpuHours: h.computeBudgetGpuHours,
        resolvedAt: h.resolvedAt,
        runCount: h._count.runs,
        createdAt: h.createdAt,
      })),
    );
  },
};

const getHypothesis: ToolDefinition = {
  name: "get_hypothesis",
  description:
    "Fetch a single hypothesis's full state including its runs (id, name, status, computeGpuHours).",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args) {
    const id = requireString(args, "id");
    const h = await prisma.hypothesis.findUnique({
      where: { id },
      include: { runs: { orderBy: { createdAt: "desc" } } },
    });
    if (!h) throw new Error(`hypothesis not found: ${id}`);
    const usedGpuHours = h.runs.reduce((acc, r) => acc + (r.computeGpuHours ?? 0), 0);
    return jsonResult({
      id: h.id,
      projectId: h.projectId,
      title: h.title,
      statement: h.statement,
      status: h.status,
      verdict: h.verdict,
      computeBudgetGpuHours: h.computeBudgetGpuHours,
      computeUsedGpuHours: usedGpuHours,
      resolvedAt: h.resolvedAt,
      runs: h.runs.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        wandbRunId: r.wandbRunId,
        computeGpuHours: r.computeGpuHours,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      })),
    });
  },
};

const listMessages: ToolDefinition = {
  name: "list_messages",
  description:
    "List AgentMessages for a project (recent feed). Filter by unread (readAt IS NULL), severity, source, or kind. Use this to read what other agents have surfaced before deciding what to do.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      unreadOnly: { type: "boolean", default: false },
      severity: { type: "string", description: "info | suggestion | decision | blocker" },
      source: { type: "string", description: "Filter to a single source (e.g. 'project-brain')." },
      kind: { type: "string", description: "note | alert | status | digest" },
      limit: { type: "number", default: 30 },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const unreadOnly = args.unreadOnly === true;
    const severity = optString(args, "severity");
    const source = optString(args, "source");
    const kind = optString(args, "kind");
    const limit = optInt(args, "limit") ?? 30;
    const messages = await prisma.agentMessage.findMany({
      where: {
        projectId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(severity ? { severity: severity as never } : {}),
        ...(source ? { source } : {}),
        ...(kind ? { kind: kind as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return jsonResult(messages);
  },
};

const listWorkhorses: ToolDefinition = {
  name: "list_workhorses",
  description:
    "List registered workhorses for a project, with their host, sessionName, lastHeartbeat (sync), lastClaudeBeat (Claude tool calls), and a derived `state` ∈ alive | idle | dead | unreachable based on staleness thresholds (3 min for unreachable, 10 min for dead, 60 min for idle).",
  inputSchema: {
    type: "object",
    properties: { projectId: { type: "string" } },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const workhorses = await prisma.workhorse.findMany({
      where: { projectId },
      orderBy: { host: "asc" },
    });
    const now = Date.now();
    return jsonResult(
      workhorses.map((w) => {
        const tmuxAlive = parseTmuxAlive(w.configJson);
        return {
          id: w.id,
          host: w.host,
          sessionName: w.sessionName,
          lastHeartbeat: w.lastHeartbeat,
          lastClaudeBeat: w.lastClaudeBeat,
          tmuxAlive,
          state: deriveWorkhorseState(now, w.lastHeartbeat, w.lastClaudeBeat, tmuxAlive),
        };
      }),
    );
  },
};

function parseTmuxAlive(configJson: string | null): boolean | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson) as { tmuxAlive?: unknown };
    return parsed.tmuxAlive === true ? true : parsed.tmuxAlive === false ? false : null;
  } catch {
    return null;
  }
}

function deriveWorkhorseState(
  now: number,
  lastHeartbeat: Date | null,
  lastClaudeBeat: Date | null,
  tmuxAlive: boolean | null,
): "alive" | "idle" | "dead" | "unreachable" {
  const hb = lastHeartbeat?.getTime() ?? 0;
  const cb = lastClaudeBeat?.getTime() ?? 0;
  const HOST_STALE_MS = 3 * 60_000;
  const CLAUDE_IDLE_MS = 30 * 60_000;

  const hostAlive = hb && now - hb < HOST_STALE_MS;
  if (!hostAlive) return "unreachable";

  if (tmuxAlive === false) return "dead";
  if (tmuxAlive === true) {
    if (cb > 0 && now - cb > CLAUDE_IDLE_MS) return "idle";
    return "alive";
  }

  // Fallback when tmux signal not yet sent (older sync.py).
  if (!cb) return "dead";
  const claudeAge = now - cb;
  if (claudeAge < 5 * 60_000) return "alive";
  if (claudeAge < CLAUDE_IDLE_MS) return "idle";
  return "dead";
}

const listBrainChats: ToolDefinition = {
  name: "list_brain_chats",
  description:
    "List recent persisted brain-chat sessions (the user's freeform Claude chats with the global brain). Returns id, title, createdAt, summarizedAt, and the bullet summary if the heartbeat has summarised it. Useful for stitching continuity across sessions: in a new chat, call this with limit=3 to see what was discussed lately.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max chats to return (default 20).",
      },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const limit = optInt(args, "limit") ?? 20;
    const chats = await prisma.brainChat.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        createdAt: true,
        summarizedAt: true,
        summaryMd: true,
      },
    });
    return jsonResult(chats);
  },
};

const getBrainChat: ToolDefinition = {
  name: "get_brain_chat",
  description:
    "Fetch a single persisted brain-chat session by id, including the full markdown transcript.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "BrainChat id." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args) {
    const id = requireString(args, "id");
    const chat = await prisma.brainChat.findUnique({ where: { id } });
    if (!chat) {
      return {
        content: [{ type: "text", text: `no brain chat with id: ${id}` }],
        isError: true,
      };
    }
    return jsonResult(chat);
  },
};

export const readTools: ToolDefinition[] = [
  listProjects,
  getProject,
  listRuns,
  summariseRun,
  listNotes,
  listDecisions,
  listCheckIns,
  listHypotheses,
  getHypothesis,
  listMessages,
  listWorkhorses,
  listBrainChats,
  getBrainChat,
];
