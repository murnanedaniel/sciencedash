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

const updateProjectFields: ToolDefinition = {
  name: "update_project_fields",
  description:
    "Patch one or more project-level fields directly (no human review). Use for project state your Claude is authoritative on — timeline updates, blockers, nextSteps, figuresOfMerit, hypothesis, narrativeReadiness, etc. For changes that should land only with human approval, attach `proposedPatches` to a `create_check_in` call instead. Patchable fields: " +
    PROJECT_PATCHABLE_FIELDS.join(", ") +
    ".",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      description: { type: "string" },
      hypothesis: { type: "string" },
      figuresOfMerit: { type: "string" },
      timeline: { type: "string" },
      nextSteps: { type: "string" },
      blockers: { type: "string" },
      narrativeReadiness: { type: "string", enum: [...NARRATIVE_READINESS] },
      narrativeReadinessNote: { type: "string" },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  async handler(args) {
    const projectId = requireString(args, "projectId");
    const data: Record<string, unknown> = {};
    for (const f of PROJECT_PATCHABLE_FIELDS) {
      const v = optString(args, f);
      if (v !== undefined) data[f] = v;
    }
    if (data.narrativeReadiness !== undefined) {
      const v = data.narrativeReadiness as string;
      if (!NARRATIVE_READINESS.includes(v as (typeof NARRATIVE_READINESS)[number])) {
        throw new Error(
          `narrativeReadiness must be one of: ${NARRATIVE_READINESS.join(", ")}; got ${v}`,
        );
      }
    }
    if (Object.keys(data).length === 0) {
      throw new Error("at least one patchable field must be provided");
    }
    const project = await prisma.project.update({
      where: { id: projectId },
      data,
      select: { id: true },
    });
    return jsonResult({ id: project.id, patched: Object.keys(data) });
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

export const writeTools: ToolDefinition[] = [
  createCheckIn,
  recordDecision,
  addNote,
  updateHypothesisStatus,
  moveRunToHypothesis,
  updateProjectFields,
  setProjectBlocker,
  postMessage,
  markMessageRead,
  queueDirective,
  dispatchWorkhorse,
  submitBrainChat,
];
