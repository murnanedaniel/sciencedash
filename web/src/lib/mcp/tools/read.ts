/**
 * Read tools — non-mutating queries against the ScienceDash DB.
 *
 * Two tools cover every entity the brain might want to read:
 *   - `query_entity(kind, ...)` — list rows of any kind, with per-kind filters.
 *   - `get_entity(kind, id)` — fetch one row by id with deeper detail.
 *
 * Per-kind filter shapes are documented in the tool description (Claude
 * reads them to decide what to pass). The flat shape keeps tool calls
 * easy to fill out without nested objects.
 */

import { prisma } from "@/lib/prisma";
import {
  jsonResult,
  optInt,
  optString,
  requireString,
} from "@/lib/mcp/server";
import type { ToolDefinition } from "@/lib/mcp/types";

const ENTITY_KINDS = [
  "project",
  "programme",
  "run",
  "hypothesis",
  "note",
  "decision",
  "check_in",
  "message",
  "workhorse",
  "brain_chat",
  "job",
  "repo_link",
  "paper",
  "tag",
  "metric_definition",
] as const;
type EntityKind = (typeof ENTITY_KINDS)[number];

/* --------------------------- query_entity --------------------------- */

const queryEntity: ToolDefinition = {
  name: "query_entity",
  description:
    "List rows of any ScienceDash entity, newest first. Pass `kind` plus any applicable filters; unused filters are ignored. Default limit is 50 (most kinds). Per-kind filter cheatsheet:\n" +
    "- project: status?, programmeId?, tag?, since?\n" +
    "- programme: status?, since?\n" +
    "- run: projectId* OR hypothesisId*, status?, since?\n" +
    "- hypothesis: projectId*, status?, verdict?\n" +
    "- note: projectId*, kind? (paper|book|talk|thread|other)\n" +
    "- decision: projectId*, kind?, since?\n" +
    "- check_in: projectId*, source?, since?\n" +
    "- message: projectId?, unreadOnly?, severity?, source?, kind?, since?\n" +
    "- workhorse: projectId?\n" +
    "- brain_chat: summarised? (boolean), since?\n" +
    "- job: projectId?, kind?, ok?, since?\n" +
    "- repo_link: projectId?\n" +
    "- paper: projectId?, status?, since?\n" +
    "- tag: (no filters; returns all tags by usage count)\n" +
    "- metric_definition: projectId*, isPrimary?\n" +
    "Asterisks mark required scoping for that kind. `since` is ISO-8601.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...ENTITY_KINDS],
        description: "Which entity to query.",
      },
      projectId: { type: "string" },
      programmeId: { type: "string" },
      hypothesisId: { type: "string" },
      status: { type: "string" },
      verdict: { type: "string" },
      kindFilter: {
        type: "string",
        description:
          "Sub-kind filter (note kind, decision kind, message kind, job kind). Aliased from `kind` to avoid clashing with the entity kind.",
      },
      tag: { type: "string" },
      source: { type: "string" },
      severity: { type: "string" },
      unreadOnly: { type: "boolean" },
      isPrimary: { type: "boolean" },
      summarised: { type: "boolean" },
      ok: { type: "boolean" },
      since: { type: "string", description: "ISO-8601 timestamp." },
      limit: { type: "number" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  async handler(args) {
    const kind = requireString(args, "kind") as EntityKind;
    if (!ENTITY_KINDS.includes(kind)) {
      throw new Error(
        `unknown kind: ${kind}; valid: ${ENTITY_KINDS.join(", ")}`,
      );
    }
    const limit = optInt(args, "limit") ?? 50;
    const projectId = optString(args, "projectId");
    const programmeId = optString(args, "programmeId");
    const hypothesisId = optString(args, "hypothesisId");
    const status = optString(args, "status");
    const verdict = optString(args, "verdict");
    const subKind = optString(args, "kindFilter");
    const tag = optString(args, "tag");
    const source = optString(args, "source");
    const severity = optString(args, "severity");
    const unreadOnly = args.unreadOnly === true;
    const isPrimary =
      typeof args.isPrimary === "boolean" ? (args.isPrimary as boolean) : undefined;
    const summarised =
      typeof args.summarised === "boolean"
        ? (args.summarised as boolean)
        : undefined;
    const ok =
      typeof args.ok === "boolean" ? (args.ok as boolean) : undefined;
    const sinceStr = optString(args, "since");
    const since = sinceStr ? new Date(sinceStr) : undefined;

    switch (kind) {
      case "project": {
        const projects = await prisma.project.findMany({
          where: {
            ...(status ? { status: status as never } : {}),
            ...(programmeId ? { programmeId } : {}),
            ...(tag ? { tags: { some: { name: tag } } } : {}),
            ...(since ? { updatedAt: { gte: since } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          include: { tags: { select: { name: true } } },
        });
        return jsonResult(
          projects.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            programmeId: p.programmeId,
            updatedAt: p.updatedAt,
            tags: p.tags.map((t) => t.name),
            blockers: p.blockers,
          })),
        );
      }
      case "programme": {
        const programmes = await prisma.programme.findMany({
          where: {
            ...(status ? { status: status as never } : {}),
            ...(since ? { updatedAt: { gte: since } } : {}),
          },
          orderBy: [{ status: "asc" }, { name: "asc" }],
          take: limit,
          include: { _count: { select: { projects: true } } },
        });
        return jsonResult(
          programmes.map((pg) => ({
            id: pg.id,
            name: pg.name,
            status: pg.status,
            description: pg.description,
            targetVenues: pg.targetVenues,
            figuresOfMerit: pg.figuresOfMerit,
            narrativeReadinessNote: pg.narrativeReadinessNote,
            projectCount: pg._count.projects,
            createdAt: pg.createdAt,
            updatedAt: pg.updatedAt,
          })),
        );
      }
      case "run": {
        if (!projectId && !hypothesisId) {
          throw new Error("kind=run requires projectId or hypothesisId");
        }
        const runs = await prisma.run.findMany({
          where: {
            ...(hypothesisId ? { hypothesisId } : {}),
            ...(projectId && !hypothesisId
              ? { hypothesis: { projectId } }
              : {}),
            ...(status ? { status: status as never } : {}),
            ...(since ? { createdAt: { gte: since } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: { hypothesis: { select: { title: true, projectId: true } } },
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
            hypothesisId: r.hypothesisId,
            hypothesisTitle: r.hypothesis.title,
            projectId: r.hypothesis.projectId,
            notes: r.notes,
          })),
        );
      }
      case "hypothesis": {
        if (!projectId)
          throw new Error("kind=hypothesis requires projectId");
        const hyps = await prisma.hypothesis.findMany({
          where: {
            projectId,
            ...(status ? { status: status as never } : {}),
            ...(verdict ? { verdict: verdict as never } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
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
      }
      case "note": {
        if (!projectId) throw new Error("kind=note requires projectId");
        const links = await prisma.noteProject.findMany({
          where: {
            projectId,
            ...(subKind ? { note: { kind: subKind as never } } : {}),
          },
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
      }
      case "decision": {
        if (!projectId) throw new Error("kind=decision requires projectId");
        const decisions = await prisma.decision.findMany({
          where: {
            projectId,
            ...(subKind ? { kind: subKind as never } : {}),
            ...(since ? { at: { gte: since } } : {}),
          },
          orderBy: { at: "desc" },
          take: limit,
        });
        return jsonResult(decisions);
      }
      case "check_in": {
        if (!projectId) throw new Error("kind=check_in requires projectId");
        const checkIns = await prisma.checkIn.findMany({
          where: {
            projectId,
            ...(source ? { source } : {}),
            ...(since ? { createdAt: { gte: since } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return jsonResult(
          checkIns.map((c) => ({
            id: c.id,
            bodyMd: c.bodyMd,
            scope: c.scope,
            kind: c.kind,
            source: c.source,
            createdAt: c.createdAt,
            proposedPatchJson: c.proposedPatchJson,
          })),
        );
      }
      case "message": {
        const messages = await prisma.agentMessage.findMany({
          where: {
            ...(projectId ? { projectId } : {}),
            ...(unreadOnly ? { readAt: null } : {}),
            ...(severity ? { severity: severity as never } : {}),
            ...(source ? { source } : {}),
            ...(subKind ? { kind: subKind as never } : {}),
            ...(since ? { createdAt: { gte: since } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: { project: { select: { id: true, title: true } } },
        });
        return jsonResult(messages);
      }
      case "workhorse": {
        const workhorses = await prisma.workhorse.findMany({
          where: { ...(projectId ? { projectId } : {}) },
          orderBy: [{ projectId: "asc" }, { host: "asc" }],
          take: limit,
        });
        const now = Date.now();
        return jsonResult(
          workhorses.map((w) => {
            const tmuxAlive = parseTmuxAlive(w.configJson);
            return {
              id: w.id,
              projectId: w.projectId,
              host: w.host,
              sessionName: w.sessionName,
              lastHeartbeat: w.lastHeartbeat,
              lastClaudeBeat: w.lastClaudeBeat,
              tmuxAlive,
              state: deriveWorkhorseState(
                now,
                w.lastHeartbeat,
                w.lastClaudeBeat,
                tmuxAlive,
              ),
            };
          }),
        );
      }
      case "brain_chat": {
        const chats = await prisma.brainChat.findMany({
          where: {
            ...(summarised === true ? { summaryMd: { not: null } } : {}),
            ...(summarised === false ? { summaryMd: null } : {}),
            ...(since ? { createdAt: { gte: since } } : {}),
          },
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
      }
      case "job": {
        const jobs = await prisma.jobRun.findMany({
          where: {
            ...(projectId ? { projectId } : {}),
            ...(subKind ? { kind: subKind as never } : {}),
            ...(ok !== undefined ? { ok } : {}),
            ...(since ? { startedAt: { gte: since } } : {}),
          },
          orderBy: { startedAt: "desc" },
          take: limit,
          select: {
            id: true,
            kind: true,
            title: true,
            projectId: true,
            startedAt: true,
            endedAt: true,
            ok: true,
            error: true,
            costUsd: true,
            // Skip messagesJson + payloadJson at list time — too noisy.
            // Use get_entity(kind="job", id) for full detail.
          },
        });
        return jsonResult(jobs);
      }
      case "repo_link": {
        const links = await prisma.repoLink.findMany({
          where: { ...(projectId ? { projectId } : {}) },
          orderBy: [{ projectId: "asc" }, { createdAt: "asc" }],
          take: limit,
        });
        return jsonResult(
          links.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            url: r.url,
            label: r.label,
            cachedLastCommitSha: r.cachedLastCommitSha,
            cachedLastCommitAt: r.cachedLastCommitAt,
            createdAt: r.createdAt,
          })),
        );
      }
      case "paper": {
        const papers = await prisma.paper.findMany({
          where: {
            ...(projectId ? { primaryProjectId: projectId } : {}),
            ...(status ? { status: status as never } : {}),
            ...(since ? { updatedAt: { gte: since } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          include: { _count: { select: { sections: true } } },
        });
        return jsonResult(
          papers.map((p) => ({
            id: p.id,
            primaryProjectId: p.primaryProjectId,
            title: p.title,
            status: p.status,
            venue: p.venue,
            arxivId: p.arxivId,
            sectionCount: p._count.sections,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        );
      }
      case "tag": {
        const tags = await prisma.tag.findMany({
          include: { _count: { select: { projects: true } } },
        });
        const sorted = tags
          .filter((t) => t._count.projects > 0)
          .sort((a, b) => {
            if (b._count.projects !== a._count.projects)
              return b._count.projects - a._count.projects;
            return a.name.localeCompare(b.name);
          })
          .slice(0, limit);
        return jsonResult(
          sorted.map((t) => ({
            id: t.id,
            name: t.name,
            projectCount: t._count.projects,
          })),
        );
      }
      case "metric_definition": {
        if (!projectId)
          throw new Error("kind=metric_definition requires projectId");
        const defs = await prisma.projectMetricDefinition.findMany({
          where: {
            projectId,
            ...(isPrimary !== undefined ? { isPrimary } : {}),
          },
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          take: limit,
        });
        return jsonResult(defs);
      }
    }
    // Unreachable — switch is exhaustive over EntityKind.
    throw new Error(`unhandled kind: ${kind as string}`);
  },
};

/* ---------------------------- get_entity ---------------------------- */

const getEntity: ToolDefinition = {
  name: "get_entity",
  description:
    "Fetch a single ScienceDash row by id with deep detail. Per-kind notes:\n" +
    "- project: includes tags, repoLinks, wandbSources, metricDefinitions, primary metric, counts of related rows.\n" +
    "- programme: includes its project list (id, title, status).\n" +
    "- run: full state with metric values (name/value/unit/direction/threshold) and hypothesis title — folds in the old summarise_run.\n" +
    "- hypothesis: full state with all runs.\n" +
    "- brain_chat: full transcript + summary.\n" +
    "- paper: includes sections (kind, title, status).\n" +
    "- job: includes payloadJson + messagesJson (heavy — only fetch when you need the trace).\n" +
    "- note, decision, check_in, message, workhorse, repo_link, tag, metric_definition: plain row by id.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...ENTITY_KINDS],
      },
      id: { type: "string" },
    },
    required: ["kind", "id"],
    additionalProperties: false,
  },
  async handler(args) {
    const kind = requireString(args, "kind") as EntityKind;
    const id = requireString(args, "id");
    if (!ENTITY_KINDS.includes(kind)) {
      throw new Error(
        `unknown kind: ${kind}; valid: ${ENTITY_KINDS.join(", ")}`,
      );
    }

    switch (kind) {
      case "project": {
        const p = await prisma.project.findUnique({
          where: { id },
          include: {
            tags: { select: { name: true } },
            metricDefinitions: true,
            repoLinks: true,
            wandbSources: true,
            programme: { select: { id: true, name: true } },
            _count: {
              select: {
                hypotheses: true,
                decisions: true,
                checkIns: true,
                notes: true,
                papers: true,
                workhorses: true,
                agentMessages: true,
              },
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
          programme: p.programme,
          primaryMetric: primary
            ? {
                name: primary.name,
                unit: primary.unit,
                direction: primary.direction,
                threshold: primary.threshold,
              }
            : null,
          metricDefinitions: p.metricDefinitions.map((m) => ({
            id: m.id,
            name: m.name,
            unit: m.unit,
            direction: m.direction,
            isPrimary: m.isPrimary,
            threshold: m.threshold,
          })),
          repoLinks: p.repoLinks.map((r) => ({
            id: r.id,
            url: r.url,
            label: r.label,
            cachedLastCommitSha: r.cachedLastCommitSha,
            cachedLastCommitAt: r.cachedLastCommitAt,
          })),
          wandbSources: p.wandbSources.map((w) => ({
            id: w.id,
            entity: w.entity,
            name: w.name,
          })),
          counts: p._count,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        });
      }
      case "programme": {
        const pg = await prisma.programme.findUnique({
          where: { id },
          include: {
            projects: {
              select: {
                id: true,
                title: true,
                status: true,
                updatedAt: true,
                blockers: true,
              },
              orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
            },
          },
        });
        if (!pg) throw new Error(`programme not found: ${id}`);
        return jsonResult(pg);
      }
      case "run": {
        const r = await prisma.run.findUnique({
          where: { id },
          include: {
            hypothesis: {
              select: { id: true, title: true, projectId: true },
            },
            metrics: { include: { definition: true } },
            wandbSource: true,
          },
        });
        if (!r) throw new Error(`run not found: ${id}`);
        return jsonResult({
          id: r.id,
          name: r.name,
          status: r.status,
          wandbRunId: r.wandbRunId,
          wandbSource: r.wandbSource
            ? { entity: r.wandbSource.entity, name: r.wandbSource.name }
            : null,
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
            isPrimary: m.definition.isPrimary,
          })),
        });
      }
      case "hypothesis": {
        const h = await prisma.hypothesis.findUnique({
          where: { id },
          include: { runs: { orderBy: { createdAt: "desc" } } },
        });
        if (!h) throw new Error(`hypothesis not found: ${id}`);
        const usedGpuHours = h.runs.reduce(
          (acc, r) => acc + (r.computeGpuHours ?? 0),
          0,
        );
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
          createdAt: h.createdAt,
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
      }
      case "note": {
        const n = await prisma.note.findUnique({ where: { id } });
        if (!n) throw new Error(`note not found: ${id}`);
        return jsonResult(n);
      }
      case "decision": {
        const d = await prisma.decision.findUnique({ where: { id } });
        if (!d) throw new Error(`decision not found: ${id}`);
        return jsonResult(d);
      }
      case "check_in": {
        const c = await prisma.checkIn.findUnique({ where: { id } });
        if (!c) throw new Error(`check_in not found: ${id}`);
        return jsonResult(c);
      }
      case "message": {
        const m = await prisma.agentMessage.findUnique({
          where: { id },
          include: { project: { select: { id: true, title: true } } },
        });
        if (!m) throw new Error(`message not found: ${id}`);
        return jsonResult(m);
      }
      case "workhorse": {
        const w = await prisma.workhorse.findUnique({ where: { id } });
        if (!w) throw new Error(`workhorse not found: ${id}`);
        const tmuxAlive = parseTmuxAlive(w.configJson);
        return jsonResult({
          ...w,
          tmuxAlive,
          state: deriveWorkhorseState(
            Date.now(),
            w.lastHeartbeat,
            w.lastClaudeBeat,
            tmuxAlive,
          ),
        });
      }
      case "brain_chat": {
        const c = await prisma.brainChat.findUnique({ where: { id } });
        if (!c) throw new Error(`brain_chat not found: ${id}`);
        return jsonResult(c);
      }
      case "job": {
        const j = await prisma.jobRun.findUnique({ where: { id } });
        if (!j) throw new Error(`job not found: ${id}`);
        return jsonResult(j);
      }
      case "repo_link": {
        const r = await prisma.repoLink.findUnique({ where: { id } });
        if (!r) throw new Error(`repo_link not found: ${id}`);
        return jsonResult(r);
      }
      case "paper": {
        const p = await prisma.paper.findUnique({
          where: { id },
          include: {
            sections: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                kind: true,
                title: true,
                contentMd: true,
                order: true,
              },
            },
          },
        });
        if (!p) throw new Error(`paper not found: ${id}`);
        return jsonResult(p);
      }
      case "tag": {
        const t = await prisma.tag.findUnique({
          where: { id },
          include: { _count: { select: { projects: true } } },
        });
        if (!t) throw new Error(`tag not found: ${id}`);
        return jsonResult({
          id: t.id,
          name: t.name,
          projectCount: t._count.projects,
        });
      }
      case "metric_definition": {
        const m = await prisma.projectMetricDefinition.findUnique({
          where: { id },
        });
        if (!m) throw new Error(`metric_definition not found: ${id}`);
        return jsonResult(m);
      }
    }
    throw new Error(`unhandled kind: ${kind as string}`);
  },
};

/* ---------------------- workhorse-state helpers --------------------- */

function parseTmuxAlive(configJson: string | null): boolean | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson) as { tmuxAlive?: unknown };
    return parsed.tmuxAlive === true
      ? true
      : parsed.tmuxAlive === false
        ? false
        : null;
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

  if (!cb) return "dead";
  const claudeAge = now - cb;
  if (claudeAge < 5 * 60_000) return "alive";
  if (claudeAge < CLAUDE_IDLE_MS) return "idle";
  return "dead";
}

export const readTools: ToolDefinition[] = [queryEntity, getEntity];
