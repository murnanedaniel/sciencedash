/**
 * Write tools — durable mutations to the ScienceDash DB.
 *
 * Every write tool is something Claude (or a workhorse agent) can call to
 * leave a trace in the project's history. Keep the surface small and
 * intent-named; "log a check-in", not "create a row".
 */

import { prisma } from "@/lib/prisma";
import { jsonResult, optString, requireString } from "@/lib/mcp/server";
import type { ToolDefinition } from "@/lib/mcp/types";

const HYPOTHESIS_STATUS = ["active", "paused", "resolved"] as const;
const HYPOTHESIS_VERDICT = [
  "pending",
  "supported",
  "refuted",
  "abandoned",
  "spawned_paper",
] as const;
const NOTE_KIND = ["paper", "book", "talk", "thread", "other"] as const;
const CHECKIN_KIND = [
  "routine",
  "plan",
  "blocker",
  "retro",
  "other",
] as const;
const DECISION_KIND = [
  "promote",
  "park",
  "narrow",
  "spawn_paper",
  "resolve",
  "retire",
  "budget_escalate",
  "paper_status_change",
  "ai_patch_applied",
  "other",
] as const;
const PROJECT_PATCHABLE_FIELDS = [
  "description",
  "hypothesis",
  "figuresOfMerit",
  "timeline",
  "nextSteps",
  "blockers",
  "narrativeReadiness",
  "narrativeReadinessNote",
] as const;
const NARRATIVE_READINESS = [
  "none",
  "figures_exist",
  "skeleton",
  "draftable",
  "drafted",
  "internal_review",
  "ready_to_submit",
] as const;

const createCheckIn: ToolDefinition = {
  name: "create_check_in",
  description:
    "Append a CheckIn to a project — the canonical surface for prose status updates, plan adoption, blocker escalation, and retros. Use `kind: 'plan'` when you're recording a multi-step plan; pair with `proposedPatches` to update project fields (timeline, nextSteps, blockers, figuresOfMerit) atomically. Prefer this over `add_note` for non-paper content.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      body: { type: "string", description: "Markdown body. Keep it terse and decision-shaped." },
      kind: {
        type: "string",
        enum: [...CHECKIN_KIND],
        description:
          "Shape of the check-in (default 'routine'). 'plan' = multi-step plan adoption; 'blocker' = something is gating progress; 'retro' = post-mortem; 'routine' = ordinary status update.",
      },
      source: {
        type: "string",
        description:
          "Origin tag — e.g. 'local-claude', 'workhorse-perlmutter:sd-cmockitu', 'project-brain'. Defaults to 'mcp-tool'.",
      },
      scope: {
        type: "string",
        description: "Optional scope label for the check-in (default 'project').",
      },
      proposedPatches: {
        type: "array",
        description:
          "Optional list of project-field updates this check-in proposes. Each item: { path: 'project.<field>', value: <new value> }. Patchable fields: " +
          PROJECT_PATCHABLE_FIELDS.map((f) => `project.${f}`).join(", ") +
          ". For direct (non-proposal) writes, use `update_project_fields` instead — `proposedPatches` here are for human review.",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            value: {},
          },
          required: ["path", "value"],
        },
      },
    },
    required: ["projectId", "body"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const body = requireString(args, "body");
    const source = optString(args, "source") ?? "mcp-tool";
    const scope = optString(args, "scope") ?? "project";
    const kind = (optString(args, "kind") ?? "routine") as (typeof CHECKIN_KIND)[number];
    if (!CHECKIN_KIND.includes(kind)) {
      throw new Error(`kind must be one of: ${CHECKIN_KIND.join(", ")}; got ${kind}`);
    }
    const proposed = (args as { proposedPatches?: unknown }).proposedPatches;
    let proposedPatchJson: string | null = null;
    if (Array.isArray(proposed) && proposed.length > 0) {
      proposedPatchJson = JSON.stringify({ proposedPatches: proposed });
    }
    const checkIn = await prisma.checkIn.create({
      data: {
        project: { connect: { id: projectId } },
        bodyMd: body,
        source,
        scope,
        kind,
        proposedPatchJson,
      },
    });
    return jsonResult({ id: checkIn.id, createdAt: checkIn.createdAt, kind });
  },
};

const recordDecision: ToolDefinition = {
  name: "record_decision",
  description:
    "Record a deliberate Decision against a project: promote, park, narrow, spawn_paper, resolve, retire, budget_escalate, paper_status_change, ai_patch_applied, other. `subjectType`/`subjectId` identify what the decision is about (e.g. subjectType='hypothesis', subjectId=<hypothesisId>). Use `evidenceIds` to link the supporting artefacts (the check-in, the run, the note) — strong-typed pointers, not prose.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      kind: { type: "string", enum: [...DECISION_KIND] },
      subjectType: {
        type: "string",
        description: "What the decision is about: 'hypothesis', 'run', 'paper', 'project', 'note', etc.",
      },
      subjectId: { type: "string", description: "Id of the subject row." },
      rationale: { type: "string", description: "Short explanation; ≤500 chars preferred." },
      evidenceIds: {
        type: "array",
        description:
          "Pointers to artefacts supporting this decision. Lets the dashboard render provenance as clickable links. Example: [{type:'checkIn', id:'cmo…'}, {type:'note', id:'cmo…'}, {type:'run', id:'cmo…'}].",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            id: { type: "string" },
          },
          required: ["type", "id"],
        },
      },
    },
    required: ["projectId", "kind", "subjectType", "subjectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const kind = requireString(args, "kind") as (typeof DECISION_KIND)[number];
    const subjectType = requireString(args, "subjectType");
    const subjectId = requireString(args, "subjectId");
    const rationale = optString(args, "rationale");
    if (!DECISION_KIND.includes(kind)) {
      throw new Error(
        `kind must be one of: ${DECISION_KIND.join(", ")}; got ${kind}`,
      );
    }
    const evidenceRaw = (args as { evidenceIds?: unknown }).evidenceIds;
    let evidenceIdsJson: string | null = null;
    if (Array.isArray(evidenceRaw) && evidenceRaw.length > 0) {
      const cleaned = evidenceRaw
        .filter((e): e is { type: string; id: string } => {
          if (!e || typeof e !== "object") return false;
          const o = e as Record<string, unknown>;
          return typeof o.type === "string" && typeof o.id === "string";
        })
        .map((e) => ({ type: e.type, id: e.id }));
      if (cleaned.length > 0) evidenceIdsJson = JSON.stringify(cleaned);
    }
    const decision = await prisma.decision.create({
      data: {
        project: { connect: { id: projectId } },
        kind,
        subjectType,
        subjectId,
        rationale,
        evidenceIdsJson,
      },
    });
    return jsonResult({ id: decision.id, at: decision.at });
  },
};

const addNote: ToolDefinition = {
  name: "add_note",
  description:
    "Add a Note to a project's *reading list* — papers, books, talks, threads with a URL or arXiv id. Do NOT use this for plans, status updates, or in-project documents (those are check-ins): the Note table is shaped around `authors`/`arxivId`/`url`/`takeaway`. Provide arxivId when known; the dashboard auto-resolves the URL.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      kind: { type: "string", enum: NOTE_KIND, default: "paper" },
      title: { type: "string" },
      authors: { type: "string", description: "Comma-separated; 'et al.' allowed." },
      url: { type: "string" },
      arxivId: { type: "string", description: "Bare arXiv id like '2407.07179'." },
      takeaway: { type: "string", description: "≤180 char one-line summary." },
      summaryMd: { type: "string", description: "Optional longer markdown notes." },
    },
    required: ["projectId", "title"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const title = requireString(args, "title");
    const kind = (optString(args, "kind") ?? "paper") as (typeof NOTE_KIND)[number];
    const authors = optString(args, "authors");
    const arxivId = optString(args, "arxivId");
    const explicitUrl = optString(args, "url");
    const url = explicitUrl ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : null);
    const takeaway = optString(args, "takeaway");
    const summaryMd = optString(args, "summaryMd");
    if (!NOTE_KIND.includes(kind)) {
      throw new Error(`kind must be one of: ${NOTE_KIND.join(", ")}`);
    }
    const note = await prisma.note.create({
      data: {
        kind,
        title,
        authors: authors ?? null,
        url,
        arxivId: arxivId ?? null,
        takeaway: takeaway ?? null,
        summaryMd: summaryMd ?? null,
        projects: { create: [{ projectId }] },
      },
    });
    return jsonResult({ id: note.id, createdAt: note.createdAt, url });
  },
};

const updateHypothesisStatus: ToolDefinition = {
  name: "update_hypothesis_status",
  description:
    "Update a hypothesis's status (active/paused/resolved) and optionally its verdict (pending/supported/refuted/abandoned/spawned_paper). Use sparingly — this is a high-stakes action.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: HYPOTHESIS_STATUS },
      verdict: { type: "string", enum: HYPOTHESIS_VERDICT },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args) {
    const id = requireString(args, "id");
    const status = optString(args, "status") as (typeof HYPOTHESIS_STATUS)[number] | undefined;
    const verdict = optString(args, "verdict") as (typeof HYPOTHESIS_VERDICT)[number] | undefined;
    if (!status && !verdict) {
      throw new Error("at least one of `status` or `verdict` must be provided");
    }
    const hyp = await prisma.hypothesis.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(verdict ? { verdict } : {}),
        ...(status === "resolved" ? { resolvedAt: new Date() } : {}),
      },
    });
    return jsonResult({ id: hyp.id, status: hyp.status, verdict: hyp.verdict, resolvedAt: hyp.resolvedAt });
  },
};

const moveRunToHypothesis: ToolDefinition = {
  name: "move_run_to_hypothesis",
  description:
    "Re-assign a Run to a different Hypothesis (must belong to the same project). Use when a run was originally logged under the wrong hypothesis.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      hypothesisId: { type: "string" },
    },
    required: ["runId", "hypothesisId"],
    additionalProperties: false,
  },
  async handler(args) {
    const runId = requireString(args, "runId");
    const hypothesisId = requireString(args, "hypothesisId");
    // Sanity: source + target hypotheses must share a project.
    const [run, target] = await Promise.all([
      prisma.run.findUnique({ where: { id: runId }, include: { hypothesis: true } }),
      prisma.hypothesis.findUnique({ where: { id: hypothesisId } }),
    ]);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (!target) throw new Error(`hypothesis not found: ${hypothesisId}`);
    if (run.hypothesis.projectId !== target.projectId) {
      throw new Error(
        `cannot move run across projects (source=${run.hypothesis.projectId}, target=${target.projectId})`,
      );
    }
    const updated = await prisma.run.update({
      where: { id: runId },
      data: { hypothesisId },
    });
    return jsonResult({ id: updated.id, hypothesisId: updated.hypothesisId });
  },
};

const AGENT_MESSAGE_KIND = ["note", "alert", "status", "digest"] as const;
const AGENT_MESSAGE_SEVERITY = ["info", "suggestion", "decision", "blocker"] as const;

const postMessage: ToolDefinition = {
  name: "post_message",
  description:
    "Post an AgentMessage to a project's feed. Use this to surface observations, alerts, decisions, or status updates that a human should review. Severity controls priority on /today: info (background), suggestion (worth a glance), decision (needs choice), blocker (stops other work). The default voice contract is terse, decision-shaped, default-silent — only post when the user would benefit from seeing this.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      body: { type: "string", description: "Markdown body. Default voice contract: terse, decision-shaped." },
      kind: { type: "string", enum: AGENT_MESSAGE_KIND, default: "note" },
      severity: { type: "string", enum: AGENT_MESSAGE_SEVERITY, default: "info" },
      source: {
        type: "string",
        description:
          "Origin tag. Conventions: 'project-brain', 'global-brain', 'workhorse-<host>:sd-<projectId>', 'local-claude', 'review-agent'. Defaults to 'mcp-tool'.",
      },
      payloadJson: {
        type: "string",
        description: "Optional structured JSON payload (e.g. action params for a propose-act).",
      },
    },
    required: ["projectId", "body"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const body = requireString(args, "body");
    const kind = (optString(args, "kind") ?? "note") as (typeof AGENT_MESSAGE_KIND)[number];
    const severity = (optString(args, "severity") ?? "info") as (typeof AGENT_MESSAGE_SEVERITY)[number];
    const source = optString(args, "source") ?? "mcp-tool";
    const payloadJson = optString(args, "payloadJson");
    if (!AGENT_MESSAGE_KIND.includes(kind)) throw new Error(`kind must be one of: ${AGENT_MESSAGE_KIND.join(", ")}`);
    if (!AGENT_MESSAGE_SEVERITY.includes(severity)) {
      throw new Error(`severity must be one of: ${AGENT_MESSAGE_SEVERITY.join(", ")}`);
    }
    const msg = await prisma.agentMessage.create({
      data: { projectId, body, kind, severity, source, payloadJson: payloadJson ?? null },
    });
    return jsonResult({ id: msg.id, createdAt: msg.createdAt });
  },
};

const markMessageRead: ToolDefinition = {
  name: "mark_message_read",
  description:
    "Mark an AgentMessage as read by setting its readAt timestamp. Useful when an agent processes a message it received via list_messages and wants to drain it from /today's unread list.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args) {
    const id = requireString(args, "id");
    const msg = await prisma.agentMessage.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return jsonResult({ id: msg.id, readAt: msg.readAt });
  },
};

const queueDirective: ToolDefinition = {
  name: "queue_directive",
  description:
    "Queue a directive (command) for a specific workhorse to consume on its next sync. Use this to trigger remote actions like reviving a tmux session ('revive_session') or canceling a pending dispatch. The directive lands as an AgentMessage with kind=directive, addressed to the named workhorse via the source string.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      host: { type: "string", description: "Workhorse host (e.g. 'perlmutter')." },
      sessionName: { type: "string", description: "tmux session name (e.g. 'sd-cmockX')." },
      name: { type: "string", description: "Directive name. Conventional values: revive_session, cancel_dispatch." },
      payloadJson: { type: "string", description: "Optional JSON payload (string-encoded)." },
    },
    required: ["projectId", "host", "sessionName", "name"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const host = requireString(args, "host");
    const sessionName = requireString(args, "sessionName");
    const name = requireString(args, "name");
    const payloadJson = optString(args, "payloadJson");
    const msg = await prisma.agentMessage.create({
      data: {
        projectId,
        kind: "directive",
        severity: "info",
        source: `dashboard@${host}:${sessionName}`,
        body: name,
        payloadJson: payloadJson ?? null,
      },
    });
    return jsonResult({ id: msg.id, createdAt: msg.createdAt });
  },
};

const dispatchWorkhorse: ToolDefinition = {
  name: "dispatch_workhorse",
  description:
    "Dispatch a directive to a specific workhorse, gated by the project's autonomy spectrum. Conservative-by-default: anything not explicitly listed in the project's `auto` or `propose` action classes will only post an 'asking permission' AgentMessage and NOT fire the directive. The actionClass is the policy key (e.g. 'restart_run', 'launch_sweep', 'revive_session'); pick one consistently per directive shape so leashes stay meaningful.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      actionClass: {
        type: "string",
        description: "Autonomy policy key — what kind of action this is.",
      },
      host: { type: "string" },
      sessionName: { type: "string" },
      directiveName: {
        type: "string",
        description: "The directive name the workhorse will execute (e.g. 'revive_session').",
      },
      payloadJson: { type: "string", description: "Optional JSON payload (string-encoded)." },
      reason: { type: "string", description: "≤200 char explanation for the user." },
    },
    required: ["projectId", "actionClass", "host", "sessionName", "directiveName"],
    additionalProperties: false,
  },
  async handler(args) {
    const { decideAutonomy } = await import("@/lib/brain/autonomy");
    const projectId = requireString(args, "projectId");
    const actionClass = requireString(args, "actionClass");
    const host = requireString(args, "host");
    const sessionName = requireString(args, "sessionName");
    const directiveName = requireString(args, "directiveName");
    const payloadJson = optString(args, "payloadJson");
    const reason = optString(args, "reason") ?? "";

    const decision = await decideAutonomy(projectId, actionClass);

    if (decision === "ask") {
      // Don't fire — surface a question instead.
      const msg = await prisma.agentMessage.create({
        data: {
          projectId,
          source: "review-agent",
          kind: "alert",
          severity: "decision",
          body: `**Permission needed** — fire \`${directiveName}\` on \`${host}:${sessionName}\`? (action class: \`${actionClass}\`)\n\n${reason}`,
          payloadJson: JSON.stringify({
            host,
            sessionName,
            directiveName,
            actionClass,
            payload: payloadJson ? safeParseJson(payloadJson) : null,
          }),
        },
      });
      return jsonResult({
        decision: "ask",
        agentMessageId: msg.id,
        note: "Action class not in project's auto/propose lists; surfaced as a permission request.",
      });
    }

    // auto OR propose: fire by enqueuing a directive AgentMessage.
    const directive = await prisma.agentMessage.create({
      data: {
        projectId,
        kind: "directive",
        severity: "info",
        source: `dashboard@${host}:${sessionName}`,
        body: directiveName,
        payloadJson: payloadJson ?? null,
      },
    });

    if (decision === "propose") {
      // Also post a cancel-grace heads-up to the user feed.
      await prisma.agentMessage.create({
        data: {
          projectId,
          source: "review-agent",
          kind: "alert",
          severity: "suggestion",
          body: `**Auto-firing** \`${directiveName}\` on \`${host}:${sessionName}\` (action class: \`${actionClass}\`). ${reason}`,
          payloadJson: JSON.stringify({
            directiveAgentMessageId: directive.id,
            cancelable: true,
          }),
        },
      });
    }

    return jsonResult({
      decision,
      directiveAgentMessageId: directive.id,
    });
  },
};

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Per-kind allow-lists of plain field updates for `update_entity`.
 * State changes that need side effects (Hypothesis status/verdict →
 * resolvedAt, Project status → blocker decision log) stay as their own
 * behavioral tools (`update_hypothesis_status`, `set_project_blocker`).
 */
const UPDATABLE_FIELDS: Record<string, readonly string[]> = {
  project: [
    "description",
    "hypothesis",
    "figuresOfMerit",
    "timeline",
    "nextSteps",
    "blockers",
    "narrativeReadiness",
    "narrativeReadinessNote",
    "programmeId",
  ],
  programme: [
    "name",
    "description",
    "targetVenues",
    "figuresOfMerit",
    "narrativeReadinessNote",
    "status",
  ],
  hypothesis: ["title", "statement", "computeBudgetGpuHours"],
  run: ["status", "notes", "computeGpuHours", "endedAt"],
  note: [
    "title",
    "takeaway",
    "summaryMd",
    "authors",
    "url",
    "arxivId",
  ],
  paper: [
    "title",
    "status",
    "abstract",
    "venue",
    "plannedVenue",
    "arxivId",
    "doi",
  ],
  metric_definition: [
    "name",
    "unit",
    "direction",
    "isPrimary",
    "threshold",
  ],
};

const PROGRAMME_STATUS = ["active", "parked"] as const;
const RUN_STATUS = ["queued", "running", "done", "failed"] as const;
const PAPER_STATUS = [
  "skeleton",
  "draft",
  "internal",
  "arxiv",
  "submitted",
  "published",
] as const;
const METRIC_DIRECTION = ["higher", "lower"] as const;

const updateEntity: ToolDefinition = {
  name: "update_entity",
  description:
    "Patch plain fields on any ScienceDash row. State changes that require side effects stay in dedicated tools — flip a hypothesis status with `update_hypothesis_status` (sets resolvedAt), flip a project to blocked with `set_project_blocker` (also writes the reason + a Decision). Per-kind writable fields:\n" +
    "- project: description, hypothesis, figuresOfMerit, timeline, nextSteps, blockers, narrativeReadiness, narrativeReadinessNote, programmeId\n" +
    "- programme: name, description, targetVenues, figuresOfMerit, narrativeReadinessNote, status (active|parked)\n" +
    "- hypothesis: title, statement, computeBudgetGpuHours\n" +
    "- run: status (queued|running|done|failed), notes, computeGpuHours, endedAt (ISO)\n" +
    "- note: title, takeaway, summaryMd, authors, url, arxivId\n" +
    "- paper: title, status (skeleton|draft|internal|arxiv|submitted|published), abstract, venue, plannedVenue, arxivId, doi\n" +
    "- metric_definition: name, unit, direction (higher|lower), isPrimary (boolean), threshold (number)\n" +
    "Pass `patch` as an object with only the fields you want to change. Empty string clears string fields where nullable; null also clears.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: Object.keys(UPDATABLE_FIELDS),
      },
      id: { type: "string" },
      patch: {
        type: "object",
        description:
          "Object of field → new value. See per-kind cheatsheet in the description.",
      },
    },
    required: ["kind", "id", "patch"],
    additionalProperties: false,
  },
  async handler(args) {
    const kind = requireString(args, "kind");
    const id = requireString(args, "id");
    const patchArg = (args as { patch?: unknown }).patch;
    if (!patchArg || typeof patchArg !== "object" || Array.isArray(patchArg)) {
      throw new Error("patch must be an object");
    }
    const allowed = UPDATABLE_FIELDS[kind];
    if (!allowed) {
      throw new Error(
        `update_entity does not support kind=${kind}; valid: ${Object.keys(UPDATABLE_FIELDS).join(", ")}`,
      );
    }
    const patch = patchArg as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const f of allowed) {
      if (!(f in patch)) continue;
      data[f] = patch[f];
    }
    if (Object.keys(data).length === 0) {
      throw new Error(
        `patch must contain at least one of: ${allowed.join(", ")}`,
      );
    }

    // Per-kind enum validation + type coercions.
    if (kind === "project" && data.narrativeReadiness !== undefined) {
      const v = String(data.narrativeReadiness);
      if (!NARRATIVE_READINESS.includes(v as (typeof NARRATIVE_READINESS)[number])) {
        throw new Error(
          `narrativeReadiness must be one of: ${NARRATIVE_READINESS.join(", ")}; got ${v}`,
        );
      }
    }
    if (kind === "programme" && data.status !== undefined) {
      const v = String(data.status);
      if (!PROGRAMME_STATUS.includes(v as (typeof PROGRAMME_STATUS)[number])) {
        throw new Error(
          `programme status must be one of: ${PROGRAMME_STATUS.join(", ")}; got ${v}`,
        );
      }
    }
    if (kind === "run" && data.status !== undefined) {
      const v = String(data.status);
      if (!RUN_STATUS.includes(v as (typeof RUN_STATUS)[number])) {
        throw new Error(`run status must be one of: ${RUN_STATUS.join(", ")}; got ${v}`);
      }
    }
    if (kind === "run" && data.endedAt !== undefined && data.endedAt !== null) {
      data.endedAt = new Date(String(data.endedAt));
    }
    if (kind === "paper" && data.status !== undefined) {
      const v = String(data.status);
      if (!PAPER_STATUS.includes(v as (typeof PAPER_STATUS)[number])) {
        throw new Error(`paper status must be one of: ${PAPER_STATUS.join(", ")}; got ${v}`);
      }
    }
    if (kind === "metric_definition" && data.direction !== undefined) {
      const v = String(data.direction);
      if (!METRIC_DIRECTION.includes(v as (typeof METRIC_DIRECTION)[number])) {
        throw new Error(
          `metric direction must be one of: ${METRIC_DIRECTION.join(", ")}; got ${v}`,
        );
      }
    }

    // Programme attachment validation (project.programmeId points at an
    // existing programme).
    if (kind === "project" && data.programmeId !== undefined && data.programmeId !== null) {
      const exists = await prisma.programme.findUnique({
        where: { id: String(data.programmeId) },
        select: { id: true },
      });
      if (!exists) throw new Error(`no programme with id "${String(data.programmeId)}"`);
    }

    // Empty-string normalisation for nullable text fields. Same rule
    // patchProjectField uses on the server side: empty trim => null.
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.trim() === "" && k !== "name" && k !== "title") {
        data[k] = null;
      }
    }

    const model = (
      {
        project: prisma.project,
        programme: prisma.programme,
        hypothesis: prisma.hypothesis,
        run: prisma.run,
        note: prisma.note,
        paper: prisma.paper,
        metric_definition: prisma.projectMetricDefinition,
      } as const
    )[kind as keyof typeof UPDATABLE_FIELDS];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated = await (model as any).update({
        where: { id },
        data,
        select: { id: true },
      });
      return jsonResult({ id: updated.id, patched: Object.keys(data) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique") || msg.includes("UNIQUE")) {
        throw new Error(`unique constraint violation: ${msg.slice(0, 200)}`);
      }
      if (msg.includes("Record to update not found")) {
        throw new Error(`${kind} not found: ${id}`);
      }
      throw e;
    }
  },
};

const setProjectBlocker: ToolDefinition = {
  name: "set_project_blocker",
  description:
    "Mark a project as blocked (or unblocked) with a free-text reason. Setting a non-empty `blockers` reason flips status to 'blocked' atomically; passing an empty string clears the reason but does NOT auto-unblock — the user picks the next status manually. The brain heartbeat skips blocked projects, so this is the right tool when a project is waiting on something external (collaborators, hardware, external review) that the user shouldn't be nagged about.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      blockers: {
        type: "string",
        description:
          "What's blocking the project. Empty string clears the reason. Omit to leave the existing reason untouched.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const blockersArg = (args as { blockers?: unknown }).blockers;
    const data: { blockers?: string | null; status?: "blocked" } = {};
    if (typeof blockersArg === "string") {
      const trimmed = blockersArg.trim();
      data.blockers = trimmed.length ? trimmed : null;
      // Setting a non-empty reason implies the project is now blocked.
      // Clearing the reason is purely informational — leave status alone.
      if (trimmed.length) data.status = "blocked";
    } else {
      // No blockers field provided — assume caller just wants status flip.
      data.status = "blocked";
    }
    const project = await prisma.project.update({
      where: { id: projectId },
      data,
      select: { id: true, status: true, blockers: true },
    });
    return jsonResult({
      id: project.id,
      status: project.status,
      blockers: project.blockers,
    });
  },
};

const submitBrainChat: ToolDefinition = {
  name: "submit_brain_chat",
  description:
    "Persist a finished brain-chat session — call this when the user signals end-of-session ('done', 'that's all', 'goodbye', or naturally stops engaging on a topic). Pass the full markdown transcript with speaker turns, plus a 3–6 bullet summary covering decisions made, open questions, and any state changes you wrote during the chat. The global brain heartbeat will surface chats lacking a summary; passing one here lets the chat be useful immediately. Title should be a 4–8 word handle (e.g. 'tracking project unblock plan', 'literature review for HEP4M').",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short handle for the chat (4–8 words).",
      },
      transcriptMd: {
        type: "string",
        description: "Full conversation reformatted as markdown with speaker turns.",
      },
      summaryMd: {
        type: "string",
        description: "Optional 3–6 bullet summary. If omitted, the heartbeat sweep fills it in.",
      },
    },
    required: ["title", "transcriptMd"],
    additionalProperties: false,
  },
  async handler(args) {
    const title = requireString(args, "title");
    const transcriptMd = requireString(args, "transcriptMd");
    const summaryMd = optString(args, "summaryMd") ?? null;
    const chat = await prisma.brainChat.create({
      data: {
        title,
        transcriptMd,
        summaryMd,
        summarizedAt: summaryMd ? new Date() : null,
      },
      select: { id: true, createdAt: true, summarizedAt: true },
    });
    return jsonResult({
      id: chat.id,
      createdAt: chat.createdAt,
      summarised: !!chat.summarizedAt,
    });
  },
};

const createProgramme: ToolDefinition = {
  name: "create_programme",
  description:
    "Create a new Programme — a coordinated cluster of projects sharing a publication strategy (e.g. 'ColliderML tracking', 'Foundation-model ingredients'). Programmes are the top-level container; projects roll up into them. Before calling, list_projects/list_programmes to make sure you're not duplicating an existing programme — Programme.name has a unique constraint and the call will error on collision. Returns the new programme id, which you can pass to create_project's programmeId or to attach_project_to_programme. Status defaults to 'active'.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short name (4–10 words). Must be unique across programmes.",
      },
      description: {
        type: "string",
        description: "One-paragraph description of the programme's thesis.",
      },
      targetVenues: {
        type: "string",
        description:
          "Free-text list of target venues (e.g. 'NeurIPS 2026, ICML 2026, JINST').",
      },
      figuresOfMerit: {
        type: "string",
        description:
          "What the programme is optimising for, written in evaluable terms.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async handler(args) {
    const name = requireString(args, "name");
    const description = optString(args, "description") ?? null;
    const targetVenues = optString(args, "targetVenues") ?? null;
    const figuresOfMerit = optString(args, "figuresOfMerit") ?? null;
    try {
      const programme = await prisma.programme.create({
        data: { name, description, targetVenues, figuresOfMerit },
        select: { id: true, name: true, status: true, createdAt: true },
      });
      return jsonResult(programme);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique") || msg.includes("UNIQUE")) {
        throw new Error(
          `another programme already has the name "${name}" — pick a different name or attach projects to the existing one`,
        );
      }
      throw e;
    }
  },
};

const createProject: ToolDefinition = {
  name: "create_project",
  description:
    "Create a new Project. Defaults to status='idea' — promotion to 'active' goes through the §16.1 promotion gate (requires hypothesis + figures of merit + at least one primary metric defined), separately from create. Before calling, list_projects to avoid duplicates. Pass `programmeId` to slot the project under an existing programme; pass `tags` (array of strings) to apply tag labels. Tags are auto-created on first use. Returns the new project id.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Short title (5–15 words). What's the one sentence that names this project?",
      },
      description: {
        type: "string",
        description: "One-paragraph description of the project.",
      },
      hypothesis: {
        type: "string",
        description: "The §16.1 hypothesis — 'if X then Y because Z'.",
      },
      programmeId: {
        type: "string",
        description:
          "Optional Programme id to attach this project to. Null/omitted = unprogrammed.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional tag labels to apply (e.g. ['exploit', 'tracking']). Tags are connectOrCreate'd by name.",
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handler(args) {
    const title = requireString(args, "title");
    const description = optString(args, "description") ?? null;
    const hypothesis = optString(args, "hypothesis") ?? null;
    const programmeId = optString(args, "programmeId") ?? null;
    const rawTags = (args as { tags?: unknown }).tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];

    if (programmeId) {
      const exists = await prisma.programme.findUnique({
        where: { id: programmeId },
        select: { id: true },
      });
      if (!exists) {
        throw new Error(`no programme with id "${programmeId}"`);
      }
    }

    const project = await prisma.project.create({
      data: {
        title,
        description,
        hypothesis,
        programmeId,
        tags: tags.length
          ? {
              connectOrCreate: tags.map((name) => ({
                where: { name },
                create: { name },
              })),
            }
          : undefined,
      },
      select: {
        id: true,
        title: true,
        status: true,
        programmeId: true,
        createdAt: true,
      },
    });
    return jsonResult(project);
  },
};

const attachProjectToProgramme: ToolDefinition = {
  name: "attach_project_to_programme",
  description:
    "Attach an existing project to an existing programme, or detach if `programmeId` is null/empty. Use this when the user wants to reorganise — e.g. 'move project X under programme Y' or 'detach X from its programme'. Returns the project's new programmeId.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      programmeId: {
        type: "string",
        description:
          "Programme id to attach to. Empty string or omitted = detach.",
      },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const programmeArg = optString(args, "programmeId");
    const programmeId = programmeArg && programmeArg.length > 0 ? programmeArg : null;

    if (programmeId) {
      const exists = await prisma.programme.findUnique({
        where: { id: programmeId },
        select: { id: true },
      });
      if (!exists) {
        throw new Error(`no programme with id "${programmeId}"`);
      }
    }

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { programmeId },
      select: { id: true, title: true, programmeId: true },
    });
    return jsonResult(project);
  },
};

const createHypothesis: ToolDefinition = {
  name: "create_hypothesis",
  description:
    "Create a new Hypothesis under a project. Hypotheses are the unit of experimental work — each has its own runs and compute budget. Before calling, list_hypotheses for the project to avoid duplicates. computeBudgetGpuHours defaults to 10 if not provided; the brain heartbeat surfaces budget escalations when actuals exceed budget. Returns the new hypothesis id. Status defaults to 'active', verdict defaults to 'pending'.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      title: {
        type: "string",
        description:
          "Short title (5–12 words). E.g. 'block-sparse attention helps tracking'.",
      },
      statement: {
        type: "string",
        description: "Optional fuller statement: 'if X then Y because Z'.",
      },
      computeBudgetGpuHours: {
        type: "number",
        description: "GPU-hour budget. Default 10.",
      },
    },
    required: ["projectId", "title"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const title = requireString(args, "title");
    const statement = optString(args, "statement") ?? null;
    const budgetArg = (args as { computeBudgetGpuHours?: unknown }).computeBudgetGpuHours;
    const computeBudgetGpuHours =
      typeof budgetArg === "number" && Number.isFinite(budgetArg) && budgetArg > 0
        ? budgetArg
        : 10;

    const exists = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) {
      throw new Error(`no project with id "${projectId}"`);
    }

    const hypothesis = await prisma.hypothesis.create({
      data: { projectId, title, statement, computeBudgetGpuHours },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        verdict: true,
        computeBudgetGpuHours: true,
        createdAt: true,
      },
    });
    return jsonResult(hypothesis);
  },
};

const createPaper: ToolDefinition = {
  name: "create_paper",
  description:
    "Create a new Paper, optionally tied to a project (primaryProjectId) and/or seeded from a hypothesis. Status defaults to 'skeleton'. Use this when the user wants to start a write-up. To attach hypotheses after creation, use update_entity on the HypothesisPaper join (not yet exposed) or do it via the dashboard.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      projectId: {
        type: "string",
        description:
          "Optional project to set as primaryProject. The paper will appear on that project's page.",
      },
      status: {
        type: "string",
        enum: [...PAPER_STATUS],
        description: "Defaults to 'skeleton'.",
      },
      abstract: { type: "string" },
      plannedVenue: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  async handler(args) {
    const title = requireString(args, "title");
    const projectId = optString(args, "projectId") ?? null;
    const status =
      (optString(args, "status") as (typeof PAPER_STATUS)[number] | undefined) ??
      "skeleton";
    if (!PAPER_STATUS.includes(status)) {
      throw new Error(`status must be one of: ${PAPER_STATUS.join(", ")}`);
    }
    const abstract = optString(args, "abstract") ?? null;
    const plannedVenue = optString(args, "plannedVenue") ?? null;

    if (projectId) {
      const exists = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!exists) throw new Error(`no project with id "${projectId}"`);
    }

    const paper = await prisma.paper.create({
      data: {
        title,
        status,
        abstract,
        plannedVenue,
        primaryProjectId: projectId,
      },
      select: {
        id: true,
        title: true,
        status: true,
        primaryProjectId: true,
        createdAt: true,
      },
    });
    return jsonResult(paper);
  },
};

const createMetricDefinition: ToolDefinition = {
  name: "create_metric_definition",
  description:
    "Create a metric definition on a project — a named, directional, optionally-thresholded number that runs report values for. Required for the §16.1 promotion gate (idea → active needs at least one primary metric). If you pass isPrimary=true, any existing primary metric on the project is demoted automatically.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      name: {
        type: "string",
        description: "e.g. 'tracking efficiency', 'AUC', 'inference latency ms'.",
      },
      unit: { type: "string", description: "e.g. '%', 'ms', 'GB'. Optional." },
      direction: {
        type: "string",
        enum: [...METRIC_DIRECTION],
        description: "higher = bigger is better, lower = smaller is better. Default 'higher'.",
      },
      isPrimary: {
        type: "boolean",
        description:
          "If true, this metric becomes the project's primary metric (demoting any existing one).",
      },
      threshold: {
        type: "number",
        description: "Optional success threshold; runs hitting this are 'green'.",
      },
    },
    required: ["projectId", "name"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const name = requireString(args, "name");
    const unit = optString(args, "unit") ?? null;
    const direction =
      (optString(args, "direction") as (typeof METRIC_DIRECTION)[number] | undefined) ??
      "higher";
    if (!METRIC_DIRECTION.includes(direction)) {
      throw new Error(`direction must be one of: ${METRIC_DIRECTION.join(", ")}`);
    }
    const isPrimary = (args as { isPrimary?: unknown }).isPrimary === true;
    const thresholdArg = (args as { threshold?: unknown }).threshold;
    const threshold =
      typeof thresholdArg === "number" && Number.isFinite(thresholdArg)
        ? thresholdArg
        : null;

    const exists = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) throw new Error(`no project with id "${projectId}"`);

    if (isPrimary) {
      await prisma.projectMetricDefinition.updateMany({
        where: { projectId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const def = await prisma.projectMetricDefinition.create({
      data: { projectId, name, unit, direction, isPrimary, threshold },
      select: {
        id: true,
        projectId: true,
        name: true,
        unit: true,
        direction: true,
        isPrimary: true,
        threshold: true,
      },
    });
    return jsonResult(def);
  },
};

const dispatchWorkhorseSession: ToolDefinition = {
  name: "dispatch_workhorse_session",
  description:
    "Spin up a brand-new workhorse on `host` for `projectId` against `repo` (absolute path on that host). On the next sync tick (≤60s) the host's sync.py picks up a `start_session` directive, registers the project locally, and launches `claude --mcp-config ... --append-system-prompt ...` in a fresh tmux session. If `initialPrompt` is provided it's tmux-send-keys'd into the REPL once it's up. Idempotent: re-dispatching kills any existing session with the same name. The host MUST already have sync.py running (one-time bootstrap via the workhorse-bootstrap launch endpoint). Returns the queued directive id. Conventionally this is auto-fired with no permission gate — counterpart is `stop_all_workhorses` for the kill switch.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      host: {
        type: "string",
        description:
          "Logical host name as it appears in `~/.sciencedash/config.json` on the target machine (e.g. 'perlmutter').",
      },
      repo: {
        type: "string",
        description:
          "Absolute path to the repo on the target host (e.g. '/global/u1/m/me/research/dipole-pulse'). Tilde expansion happens on the workhorse side.",
      },
      initialPrompt: {
        type: "string",
        description:
          "Optional first user message to send into the Claude REPL once it's up. Skip if you want the user to drive interactively.",
      },
    },
    required: ["projectId", "host", "repo"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const host = requireString(args, "host");
    const repo = requireString(args, "repo");
    const initialPrompt = optString(args, "initialPrompt");

    // Project must exist (FK enforcement + clearer error).
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error(`project not found: ${projectId}`);

    const sessionName = `sd-${projectId.slice(0, 10)}`;

    // Cancel any pending unread `stop_session` directives for this
    // (host, session). Same race fix as the workhorse-bootstrap launch
    // endpoint: a stale stop intent could otherwise immediately undo
    // the registration we're about to queue.
    await prisma.agentMessage.updateMany({
      where: {
        projectId,
        kind: "directive",
        body: "stop_session",
        source: { endsWith: `:${sessionName}` },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    const payload: Record<string, unknown> = { repo };
    if (initialPrompt && initialPrompt.trim()) {
      payload.initialPrompt = initialPrompt.trim();
    }

    const directive = await prisma.agentMessage.create({
      data: {
        projectId,
        kind: "directive",
        severity: "info",
        source: `mcp@${host}:${sessionName}`,
        body: "start_session",
        payloadJson: JSON.stringify(payload),
      },
    });

    return jsonResult({
      directiveId: directive.id,
      projectId,
      host,
      sessionName,
      repo,
      note: "Queued. Workhorse should appear on the project page within ~60s once sync.py picks up the directive.",
    });
  },
};

const stopAllWorkhorses: ToolDefinition = {
  name: "stop_all_workhorses",
  description:
    "Kill switch — queue `stop_session` directives for every registered Workhorse and delete the rows from the dashboard. Use when the user signals 'stop everything' or 'shut down all workhorses'. Returns the count stopped. Safe to call when nothing is running (returns 0).",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler() {
    const workhorses = await prisma.workhorse.findMany({
      select: { id: true, host: true, projectId: true, sessionName: true },
    });
    if (workhorses.length === 0) {
      return jsonResult({ stopped: 0, note: "no registered workhorses" });
    }
    // Queue directives in one batch, then delete the rows. The
    // /api/mcp/sync flap-prevention guard (pendingStopSession) keeps
    // sync.py from re-upserting them before the directive fires.
    await prisma.agentMessage.createMany({
      data: workhorses.map((w) => ({
        projectId: w.projectId,
        kind: "directive",
        severity: "info",
        source: `mcp@${w.host}:${w.sessionName}`,
        body: "stop_session",
        payloadJson: null,
      })),
    });
    await prisma.workhorse.deleteMany({
      where: { id: { in: workhorses.map((w) => w.id) } },
    });
    return jsonResult({
      stopped: workhorses.length,
      hosts: Array.from(new Set(workhorses.map((w) => w.host))),
    });
  },
};

const removeWorkhorse: ToolDefinition = {
  name: "remove_workhorse",
  description:
    "Stop and unregister a workhorse. Queues a `stop_session` directive (sync.py kills the tmux session + removes the project from the host's local ~/.sciencedash/config.json) and deletes the Workhorse row from the dashboard. Same mechanism as the dashboard's Remove button. Other workhorses on the same host (for other projects) are unaffected.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Workhorse id." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async handler(args) {
    const id = requireString(args, "id");
    const w = await prisma.workhorse.findUnique({
      where: { id },
      select: { id: true, host: true, projectId: true, sessionName: true },
    });
    if (!w) throw new Error(`workhorse not found: ${id}`);
    await prisma.agentMessage.create({
      data: {
        projectId: w.projectId,
        kind: "directive",
        severity: "info",
        source: `mcp@${w.host}:${w.sessionName}`,
        body: "stop_session",
        payloadJson: null,
      },
    });
    await prisma.workhorse.delete({ where: { id } });
    return jsonResult({
      id: w.id,
      host: w.host,
      sessionName: w.sessionName,
      removed: true,
    });
  },
};

const refreshRepo: ToolDefinition = {
  name: "refresh_repo",
  description:
    "Force a fresh GitHub commit-state pull for a project's RepoLink(s). Updates `cachedLastCommitSha` / `cachedLastCommitAt` and logs a JobRun(kind='github_pull') per link. Use when the brain wants to see the very latest commit, not whatever the background worker has cached. Pass `repoLinkId` to refresh just one link, or `projectId` alone to refresh all of that project's repos. Requires GITHUB_PAT in server env.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      repoLinkId: { type: "string" },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = optString(args, "projectId");
    const repoLinkId = optString(args, "repoLinkId");
    if (!projectId && !repoLinkId) {
      throw new Error("refresh_repo requires projectId or repoLinkId");
    }

    const { pullOneRepoLink } = await import("@/lib/ingest/github");

    const ids: string[] = [];
    if (repoLinkId) {
      ids.push(repoLinkId);
    } else if (projectId) {
      const links = await prisma.repoLink.findMany({
        where: { projectId },
        select: { id: true },
      });
      ids.push(...links.map((l) => l.id));
    }
    if (ids.length === 0) {
      return jsonResult({ refreshed: [], note: "no RepoLinks found for that scope" });
    }

    const results = [];
    for (const id of ids) {
      const r = await pullOneRepoLink(id);
      results.push({ repoLinkId: id, ...(r ?? { ok: false, error: "not found" }) });
    }
    return jsonResult({ refreshed: results });
  },
};

export const writeTools: ToolDefinition[] = [
  createCheckIn,
  recordDecision,
  addNote,
  updateHypothesisStatus,
  moveRunToHypothesis,
  updateEntity,
  setProjectBlocker,
  postMessage,
  markMessageRead,
  queueDirective,
  dispatchWorkhorse,
  submitBrainChat,
  createProgramme,
  createProject,
  attachProjectToProgramme,
  createHypothesis,
  createPaper,
  createMetricDefinition,
  refreshRepo,
  removeWorkhorse,
  dispatchWorkhorseSession,
  stopAllWorkhorses,
];
