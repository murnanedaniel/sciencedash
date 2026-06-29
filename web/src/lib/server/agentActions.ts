/**
 * Server-side orchestrators for long-running Claude Agent sessions.
 *
 * Design: the Claude agent gets a narrow tool surface (file edits only).
 * Everything destructive or networked — repo creation, git clone, git
 * push — happens in app code outside the session. GITHUB_PAT never
 * reaches the model's env.
 */

import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { kickOffAgentJob } from "@/lib/worker";
import { tmpdir } from "node:os";
import {
  callClaudeAgent,
  canUseToolScopedToCwd,
  canUseToolForWebResearch,
  canUseToolForReview,
  jobTmpDir,
} from "@/lib/ai/agentClient";
import { extractJson } from "@/lib/ai/client";
import { buildSciencedashSdkServer } from "@/lib/mcp/sdkServer";
import { fetchArxivMeta } from "@/lib/ingest/arxiv";

/* ----------------------- small subprocess helper ------------------- */

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + e.message }));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (opts.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

/* ------------------- github rest helpers --------------------------- */

type GhRepo = { html_url: string; clone_url: string; full_name: string };

async function gh<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: T | null; text: string }> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");
  const resp = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      authorization: `Bearer ${pat}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await resp.text();
  let body: T | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { ok: resp.ok, status: resp.status, body, text };
}

function parseOwnerRepo(s: string): { owner: string; repo: string } | null {
  const m = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

function appendToLog(jobId: string, line: string) {
  // Append a synthetic "system" line to the trace so the user sees what
  // the orchestrator (non-model code) is doing.
  const entry =
    JSON.stringify({
      kind: "system",
      at: new Date().toISOString(),
      subtype: "orchestrator",
      content: { message: line },
    }) + "\n";
  return prisma.jobRun
    .update({
      where: { id: jobId },
      data: { messagesJson: { set: undefined } },
    })
    .catch(() => null)
    .then(async () => {
      const cur = await prisma.jobRun.findUnique({
        where: { id: jobId },
        select: { messagesJson: true },
      });
      await prisma.jobRun.update({
        where: { id: jobId },
        data: { messagesJson: (cur?.messagesJson ?? "") + entry },
      });
    });
}

/* ---------------------- quickstart orchestrator -------------------- */

export type QuickstartInput = {
  projectId: string;
  name: string; // new repo name
  instructions: string; // free-form; may be empty
  isPrivate?: boolean; // default true
  template?: string; // owner/repo; falls back to SCIENCEDASH_REPO_TEMPLATE
};

export async function startRepoQuickstart(
  input: QuickstartInput,
): Promise<{ jobId: string } | { error: string }> {
  // Per-run template wins; env var is a convenience default.
  const tplSpec = input.template?.trim() || process.env.SCIENCEDASH_REPO_TEMPLATE;
  if (!tplSpec) {
    return {
      error:
        "No template repo specified. Enter one (owner/repo) in the modal, or set SCIENCEDASH_REPO_TEMPLATE in web/.env.",
    };
  }
  const tpl = parseOwnerRepo(tplSpec);
  if (!tpl) return { error: `Template must be in owner/repo format, got "${tplSpec}"` };
  if (!process.env.GITHUB_PAT) {
    return { error: "GITHUB_PAT env var is not set" };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(input.name)) {
    return { error: `invalid repo name: "${input.name}"` };
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { tags: true, metricDefinitions: true },
  });
  if (!project) return { error: "project not found" };

  const job = await prisma.jobRun.create({
    data: {
      kind: "repo_quickstart",
      title: `Quickstart: ${input.name}`,
      projectId: input.projectId,
      startedAt: new Date(),
    },
  });

  kickOffAgentJob(job.id, async (ctrl) => {
    // 1. Create repo from template.
    await appendToLog(job.id, `Creating repo from template ${tpl.owner}/${tpl.repo}…`);
    const create = await gh<GhRepo>(
      `/repos/${tpl.owner}/${tpl.repo}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          description: project.title,
          private: input.isPrivate ?? true,
          include_all_branches: false,
        }),
      },
    );
    if (!create.ok || !create.body) {
      throw new Error(
        `GitHub generate failed (${create.status}): ${create.text.slice(0, 400)}`,
      );
    }
    const newRepo = create.body;
    await appendToLog(job.id, `Repo created: ${newRepo.html_url}. Waiting for GitHub to finish scaffolding…`);

    // 2. Poll until the repo is ready. Template-generate is async.
    const [owner, repo] = newRepo.full_name.split("/") as [string, string];
    const readinessDeadline = Date.now() + 60_000;
    while (Date.now() < readinessDeadline) {
      if (ctrl.signal.aborted) throw new Error("aborted");
      const check = await gh<{ default_branch?: string }>(
        `/repos/${owner}/${repo}`,
      );
      if (check.ok) {
        // Extra: check that HEAD exists (template-generate sometimes reports
        // ready but has no commits yet).
        const branches = await gh<Array<{ name: string }>>(
          `/repos/${owner}/${repo}/branches`,
        );
        if (branches.ok && (branches.body?.length ?? 0) > 0) break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 3. Clone into a jobId-scoped tmpdir.
    const workdir = jobTmpDir(job.id);
    await rm(workdir, { recursive: true, force: true });
    await mkdir(workdir, { recursive: true });
    const cloneUrl = newRepo.clone_url.replace(
      "https://",
      `https://x-access-token:${process.env.GITHUB_PAT}@`,
    );
    await appendToLog(job.id, `Cloning into ${workdir}…`);
    const clone = await runCmd("git", ["clone", "--depth", "1", cloneUrl, workdir]);
    if (clone.code !== 0) {
      throw new Error(`git clone failed: ${clone.stderr.slice(0, 500)}`);
    }
    // Configure author — required for commits on a fresh clone.
    await runCmd("git", ["-C", workdir, "config", "user.name", "ScienceDash"]);
    await runCmd("git", ["-C", workdir, "config", "user.email", "sciencedash@localhost"]);

    // 4. Build agent input and invoke.
    const primary = project.metricDefinitions.find((m) => m.isPrimary);
    const ctx = {
      project: {
        title: project.title,
        description: project.description,
        hypothesis: project.hypothesis,
        figuresOfMerit: project.figuresOfMerit,
        tags: project.tags.map((t) => t.name),
        primaryMetric: primary
          ? { name: primary.name, unit: primary.unit, direction: primary.direction }
          : null,
      },
      newRepo: newRepo.html_url,
      template: `${tpl.owner}/${tpl.repo}`,
      workingDirectory: workdir,
      specialInstructions: input.instructions || null,
    };
    const userContent = [
      "You are editing a freshly-generated repo. Project context follows as JSON.",
      "Populate the scaffolded files with project-specific content. Keep edits minimal.",
      "Working directory: " + workdir,
      "",
      "```json",
      JSON.stringify(ctx, null, 2),
      "```",
    ].join("\n");

    await appendToLog(job.id, "Invoking Claude Agent to populate template files…");
    await callClaudeAgent({
      jobId: job.id,
      promptName: "repo-quickstart",
      userContent,
      cwd: workdir,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
      canUseTool: canUseToolScopedToCwd(workdir),
      maxTurns: 30,
      wallClockMs: 5 * 60_000,
      abortSignal: ctrl.signal,
    });

    // If the agent run itself failed, callClaudeAgent wrote ok=false already.
    // Don't push in that case — leave the remote in its template-pristine state.
    const after = await prisma.jobRun.findUnique({
      where: { id: job.id },
      select: { ok: true, error: true },
    });
    if (!after?.ok) {
      await appendToLog(
        job.id,
        `Agent did not complete cleanly (error: ${after?.error ?? "unknown"}); skipping push.`,
      );
      await rm(workdir, { recursive: true, force: true });
      return;
    }

    // 5. Stage, commit, push.
    await appendToLog(job.id, "Committing + pushing…");
    await runCmd("git", ["-C", workdir, "add", "."]);
    const status = await runCmd("git", ["-C", workdir, "status", "--porcelain"]);
    if (status.stdout.trim()) {
      const commit = await runCmd("git", [
        "-C",
        workdir,
        "commit",
        "-m",
        `sciencedash quickstart: ${project.title}`,
      ]);
      if (commit.code !== 0) {
        throw new Error(`git commit failed: ${commit.stderr.slice(0, 500)}`);
      }
      const push = await runCmd("git", ["-C", workdir, "push", "origin", "HEAD"]);
      if (push.code !== 0) {
        throw new Error(`git push failed: ${push.stderr.slice(0, 500)}`);
      }
    } else {
      await appendToLog(job.id, "Agent made no file changes; nothing to commit.");
    }

    // 6. Attach as RepoLink on the project.
    await prisma.repoLink.create({
      data: {
        projectId: input.projectId,
        url: newRepo.html_url,
        label: "quickstart",
      },
    });
    await appendToLog(
      job.id,
      `Done. New RepoLink attached to project (${newRepo.html_url}).`,
    );

    // 7. Clean up tmpdir.
    await rm(workdir, { recursive: true, force: true });

    // callClaudeAgent already closed the JobRun with ok=true. We only need
    // to re-set ok=true in case the push path ran AFTER the agent's
    // finalisation update (it did) — callClaudeAgent's endedAt is fine.
  });

  return { jobId: job.id };
}

/* --------------------- literature review --------------------------- */

type LiteraturePaper = {
  arxivId: string | null;
  title: string;
  authors: string;
  takeaway: string;
  confidence: "high" | "medium" | "low";
};
type LiteratureOutput = { papers: LiteraturePaper[]; rationale: string };

/** Cheap case-insensitive token-overlap ratio to guard against drift. */
function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter((t) => t.length >= 3);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

export async function runLiteratureReview(
  projectId: string,
  extraInstructions?: string,
): Promise<
  | { ok: true; jobId: string; created: number; updated: number; kept: number; dropped: number; rationale: string }
  | { ok: false; jobId?: string; error: string }
> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tags: true,
      metricDefinitions: true,
      notes: { include: { note: true } },
    },
  });
  if (!project) return { ok: false, error: "project not found" };

  const primary = project.metricDefinitions.find((m) => m.isPrimary);
  const existingArxivIds = new Set(
    project.notes
      .map((np) => np.note.arxivId)
      .filter((x): x is string => !!x),
  );
  // Notes on this project that were previously flagged as unverified —
  // candidates for in-place backfill when Claude returns a verified id +
  // a title-similar match this run.
  const unverifiedCandidates = project.notes
    .map((np) => np.note)
    .filter(
      (n) =>
        !n.arxivId &&
        (n.takeaway ?? "").startsWith("[unverified citation]"),
    );

  const payload = {
    project: {
      title: project.title,
      description: project.description,
      hypothesis: project.hypothesis,
      figuresOfMerit: project.figuresOfMerit,
      tags: project.tags.map((t) => t.name),
      primaryMetric: primary
        ? { name: primary.name, unit: primary.unit, direction: primary.direction }
        : null,
    },
    existingNotes: project.notes.slice(0, 10).map((np) => ({
      title: np.note.title,
      arxivId: np.note.arxivId,
      takeaway: np.note.takeaway,
    })),
    extraInstructions: extraInstructions || null,
  };

  // Spin up the JobRun up front so the trace viewer can be opened before
  // the agent even starts turning.
  const job = await prisma.jobRun.create({
    data: {
      kind: "literature_review",
      title: `Literature review: ${project.title}`,
      projectId,
      startedAt: new Date(),
    },
  });

  // Multi-turn agent with WebSearch (unrestricted) + WebFetch (arxiv only)
  // so Claude can resolve its own half-memories instead of omitting them.
  // No file tools; cwd is an ephemeral tmpdir (not project state).
  const agent = await callClaudeAgent({
    jobId: job.id,
    promptName: "literature-review",
    userContent: JSON.stringify(payload, null, 2),
    cwd: tmpdir(),
    allowedTools: ["WebSearch", "WebFetch"],
    canUseTool: canUseToolForWebResearch(["arxiv.org"]),
    maxTurns: 20,
    wallClockMs: 8 * 60_000,
  });

  // Parse JSON from the agent's final assistant message.
  let parsed: LiteratureOutput | null = null;
  let parseError: string | null = null;
  if (agent.ok && agent.resultText) {
    try {
      parsed = extractJson<LiteratureOutput>(agent.resultText);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  // Persist rationale + proposed papers to payloadJson either way, so the
  // /jobs/<id> audit block still works even on partial failure.
  const rationale = parsed?.rationale ?? "";
  const papersForAudit = Array.isArray(parsed?.papers) ? parsed.papers : [];
  await prisma.jobRun
    .update({
      where: { id: job.id },
      data: {
        payloadJson: JSON.stringify({
          rationale,
          papersProposed: papersForAudit,
          inputPayload: payload,
          parseError,
        }),
      },
    })
    .catch(() => null);

  if (!agent.ok) {
    return {
      ok: false,
      jobId: job.id,
      error: agent.error ?? "agent session failed",
    };
  }
  if (!parsed) {
    return {
      ok: false,
      jobId: job.id,
      error: parseError ?? "could not parse JSON from agent output",
    };
  }

  // Trust Claude's self-regulation on count — the §16.6 prompt already
  // says "invented worse than zero, fewer-better, don't pad." Imposing
  // a hard cap here would silently drop load-bearing papers.
  const papers = Array.isArray(parsed.papers) ? parsed.papers : [];

  // Verify arxiv ids in parallel. Don't drop papers — just unverify.
  const verified: LiteraturePaper[] = await Promise.all(
    papers.map(async (p) => {
      if (!p.arxivId) return p;
      try {
        const meta = await fetchArxivMeta(p.arxivId);
        if (!meta || titleSimilarity(meta.title, p.title) < 0.5) {
          return {
            ...p,
            arxivId: null,
            confidence: "low" as const,
            takeaway: `[unverified citation] ${p.takeaway}`,
          };
        }
        return p;
      } catch {
        return {
          ...p,
          arxivId: null,
          confidence: "low" as const,
          takeaway: `[unverified citation] ${p.takeaway}`,
        };
      }
    }),
  );

  // Two-pass ingest:
  //   Pass 1 — backfill: for each verified paper (arxivId != null), check
  //            if this project has an unverified note with a title-similar
  //            match. If so, update in place (fill arxivId/url, strip the
  //            "[unverified citation]" prefix). Don't create a duplicate.
  //   Pass 2 — create: for every paper not consumed by pass 1 and not
  //            already in the project's arxiv-id set, create a new note.
  const unverifiedPool = [...unverifiedCandidates];
  const consumed = new Set<number>(); // indices into `verified`
  let updated = 0;

  for (let i = 0; i < verified.length; i++) {
    const p = verified[i]!;
    if (!p.arxivId) continue;
    // Best-match over the remaining unverified pool.
    let bestIdx = -1;
    let bestScore = 0;
    for (let j = 0; j < unverifiedPool.length; j++) {
      const cand = unverifiedPool[j]!;
      const s = titleSimilarity(cand.title, p.title);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.6) {
      const cand = unverifiedPool[bestIdx]!;
      try {
        const stripped = (cand.takeaway ?? "").replace(
          /^\[unverified citation\]\s*/,
          "",
        );
        await prisma.note.update({
          where: { id: cand.id },
          data: {
            arxivId: p.arxivId,
            url: `https://arxiv.org/abs/${p.arxivId}`,
            // Prefer Claude's authors if the existing row is empty,
            // otherwise keep the curated value.
            authors: cand.authors || p.authors || null,
            takeaway: stripped || p.takeaway || null,
          },
        });
        updated++;
        consumed.add(i);
        unverifiedPool.splice(bestIdx, 1);
        existingArxivIds.add(p.arxivId); // prevent a later create collision
      } catch {
        // If the update fails, fall through to the create path.
      }
    }
  }

  // Pass 2: dedupe then create everything not consumed by backfill.
  const survivors = verified.filter((p, i) => {
    if (consumed.has(i)) return false;
    if (!p.arxivId) return true; // keep unverified papers as new notes
    return !existingArxivIds.has(p.arxivId);
  });

  let created = 0;
  for (const p of survivors) {
    try {
      await prisma.note.create({
        data: {
          kind: "paper",
          title: p.title,
          authors: p.authors || null,
          arxivId: p.arxivId,
          url: p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : null,
          takeaway: p.takeaway || null,
          projects: { create: [{ projectId }] },
        },
      });
      created++;
    } catch {
      // Swallow individual-row errors; rest of the batch still lands.
    }
  }

  return {
    ok: true,
    jobId: job.id,
    created,
    updated,
    kept: survivors.length + updated,
    dropped: papers.length - survivors.length - updated,
    rationale: parsed.rationale ?? "",
  };
}

/* --------------------- critical review v2 -------------------------- */

type CriticalReviewOutput = {
  diagnosis: string;
  recommendation: "narrow" | "promote_to_paper" | "park" | "escalate_budget" | "continue";
  evidence?: Array<{ type: string; ref: string; quote: string }>;
  proposedPatches: Array<{ path: string; value: string }>;
  rationale: string;
};

export async function runCriticalReview(projectId: string): Promise<
  | { ok: true; jobId: string; recommendation: string; costUsd: number | null }
  | { ok: false; jobId?: string; error: string }
> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true },
  });
  if (!project) return { ok: false, error: "project not found" };

  const job = await prisma.jobRun.create({
    data: {
      kind: "ai_review",
      title: `Critical review: ${project.title}`,
      projectId,
      startedAt: new Date(),
    },
  });

  const dashboardUrl = process.env.SCIENCEDASH_BASE_URL ?? "http://localhost:3000";
  const userContent = JSON.stringify(
    {
      projectId,
      hint:
        "Use the ScienceDash MCP read tools to investigate this project's actual state — runs, decisions, notes, hypotheses, recent check-ins. Then return the JSON output specified in the system prompt.",
    },
    null,
    2,
  );

  const agent = await callClaudeAgent({
    jobId: job.id,
    promptName: "critical-review",
    userContent,
    cwd: tmpdir(),
    allowedTools: ["WebSearch", "WebFetch"],
    canUseTool: canUseToolForReview(["arxiv.org"]),
    mcpServers: {
      sciencedash: buildSciencedashSdkServer(),
    },
    maxTurns: 25,
    wallClockMs: 8 * 60_000,
  });

  let parsed: CriticalReviewOutput | null = null;
  let parseError: string | null = null;
  if (agent.ok && agent.resultText) {
    try {
      parsed = extractJson<CriticalReviewOutput>(agent.resultText);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  await prisma.jobRun
    .update({
      where: { id: job.id },
      data: {
        payloadJson: JSON.stringify({
          parsed,
          parseError,
          mcpDashboardUrl: dashboardUrl,
        }),
      },
    })
    .catch(() => null);

  if (!agent.ok) {
    return { ok: false, jobId: job.id, error: agent.error ?? "agent session failed" };
  }
  if (!parsed) {
    return { ok: false, jobId: job.id, error: parseError ?? "could not parse JSON" };
  }

  // Persist as a CheckIn (existing convention) so the result lands on the
  // project's activity feed with the proposed patches available for the
  // user to accept one-by-one. The richer evidence + parsed structure is
  // also kept on the JobRun's payloadJson for /jobs/<id>.
  await prisma.checkIn.create({
    data: {
      scope: "project",
      projectId,
      source: "ai",
      bodyMd: parsed.rationale,
      proposedPatchJson: JSON.stringify({
        diagnosis: parsed.diagnosis,
        recommendation: parsed.recommendation,
        rationale: parsed.rationale,
        proposedPatches: parsed.proposedPatches,
        evidence: parsed.evidence ?? [],
        costUsd: agent.costUsd,
      }),
    },
  });

  // Also drop a feed message so the user notices.
  await prisma.agentMessage.create({
    data: {
      projectId,
      source: "review-agent",
      kind: "note",
      severity: parsed.recommendation === "park" ? "decision" : "suggestion",
      body: `**${parsed.recommendation}** — ${parsed.diagnosis}`,
      payloadJson: JSON.stringify({
        recommendation: parsed.recommendation,
        evidenceCount: parsed.evidence?.length ?? 0,
        proposedPatchCount: parsed.proposedPatches.length,
        jobId: job.id,
      }),
    },
  }).catch(() => null);

  return {
    ok: true,
    jobId: job.id,
    recommendation: parsed.recommendation,
    costUsd: agent.costUsd,
  };
}
