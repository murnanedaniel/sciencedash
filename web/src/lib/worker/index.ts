import { prisma } from "@/lib/prisma";
import { withMutex } from "@/lib/worker/mutex";
import { pullWandb } from "@/lib/ingest/wandb";
import { pullGithub } from "@/lib/ingest/github";
import { runHeartbeat } from "@/lib/brain/heartbeat";
import { decideAutonomy } from "@/lib/brain/autonomy";
import type { JobKind } from "@/generated/prisma/client";

type Tick = {
  kind: JobKind;
  everyMs: number;
  run: () => Promise<Record<string, unknown>>;
};

async function runTick(t: Tick) {
  const outcome = await withMutex(t.kind, async () => {
    const job = await prisma.jobRun.create({
      data: { kind: t.kind, startedAt: new Date() },
    });
    try {
      const payload = await t.run();
      await prisma.jobRun.update({
        where: { id: job.id },
        data: {
          ok: true,
          endedAt: new Date(),
          payloadJson: JSON.stringify(payload ?? {}),
        },
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await prisma.jobRun.update({
        where: { id: job.id },
        data: { ok: false, endedAt: new Date(), error: err.slice(0, 1000) },
      });
    }
  });
  // outcome === null means the mutex was held; fine — skip.
  void outcome;
}

/**
 * Stall detection: any active project whose latest signal is older than 14
 * days surfaces on /today. For projects with aiAutoReviewEnabled=true, we
 * automatically invoke the critical-review pipeline; otherwise we enqueue a
 * JobRun row awaiting an explicit click.
 */
async function stallDetect(): Promise<Record<string, unknown>> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const projects = await prisma.project.findMany({
    where: { status: "active" },
    include: {
      hypotheses: {
        include: { runs: { orderBy: { endedAt: "desc" }, take: 1 } },
      },
      decisions: { orderBy: { at: "desc" }, take: 1 },
      checkIns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const stalled: string[] = [];
  const autoQueued: string[] = [];
  for (const p of projects) {
    const lastRun = p.hypotheses
      .flatMap((h) => h.runs)
      .map((r) => r.endedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const last = Math.max(
      p.updatedAt.getTime(),
      p.decisions[0]?.at.getTime() ?? 0,
      p.checkIns[0]?.createdAt.getTime() ?? 0,
      lastRun,
    );
    if (last < cutoff.getTime()) {
      stalled.push(p.id);
      if (p.aiAutoReviewEnabled) {
        autoQueued.push(p.id);
        // Best-effort: trigger the route handler on localhost. If the server
        // hasn't finished starting, skip — next tick will retry.
        try {
          await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/ai/review`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: p.id }),
          });
        } catch {
          /* swallow */
        }
      } else {
        // Queue a placeholder JobRun the user can consume with one click.
        const already = await prisma.jobRun.findFirst({
          where: { kind: "ai_review", projectId: p.id, ok: null },
        });
        if (!already) {
          await prisma.jobRun.create({
            data: { kind: "ai_review", projectId: p.id, startedAt: new Date() },
          });
        }
      }
    }
  }
  return { stalledCount: stalled.length, autoQueued: autoQueued.length };
}

/**
 * Brain tick — once per active project per hour, gated by autonomy.
 *
 * Per-project autonomy decision (from `autonomyJson.{auto,propose,ask}`
 * containing the action class `brain_heartbeat`):
 *   - auto:    runHeartbeat(p.id, mode="auto")    — full MCP write surface.
 *   - propose: runHeartbeat(p.id, mode="propose") — message-level writes only.
 *   - ask:     queue a placeholder JobRun the user can one-click. No agent runs.
 *
 * Cost predictability: ~5min wall-clock per project max (heartbeat anti-burn
 * floor is 5min), plus the existing MIN_INTERVAL_MS guard inside runHeartbeat.
 */
async function brainTick(): Promise<Record<string, unknown>> {
  const projects = await prisma.project.findMany({
    where: { status: "active" },
    select: { id: true, title: true },
  });
  const ran: string[] = [];
  const proposed: string[] = [];
  const queued: string[] = [];
  const errors: Array<{ projectId: string; error: string }> = [];
  for (const p of projects) {
    const decision = await decideAutonomy(p.id, "brain_heartbeat");
    if (decision === "ask") {
      // One-click placeholder — only enqueue if there isn't already an
      // unconsumed one waiting. Avoids stacking pending heartbeats.
      const existing = await prisma.jobRun.findFirst({
        where: { kind: "project_brain", projectId: p.id, ok: null },
      });
      if (!existing) {
        await prisma.jobRun.create({
          data: {
            kind: "project_brain",
            projectId: p.id,
            title: `Brain heartbeat (queued, awaiting click): ${p.title}`,
            startedAt: new Date(),
            payloadJson: JSON.stringify({ awaiting_user: true }),
          },
        });
        queued.push(p.id);
      }
      continue;
    }
    try {
      const result = await runHeartbeat(p.id, { mode: decision });
      if ("ok" in result && result.ok) {
        if ("skipped" in result && result.skipped) continue;
        if (decision === "auto") ran.push(p.id);
        else proposed.push(p.id);
      } else if ("error" in result) {
        errors.push({ projectId: p.id, error: result.error });
      }
    } catch (e) {
      errors.push({
        projectId: p.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    activeProjects: projects.length,
    ranAuto: ran.length,
    ranPropose: proposed.length,
    queuedAwaitingClick: queued.length,
    errors,
  };
}

/**
 * Workhorse tick — queue a `workhorse_tick` directive for each alive
 * workhorse on a project whose autonomy bucket includes `workhorse_tick`
 * in `auto`. sync.py picks the directive up on its next sync (≤60s) and
 * tmux-send-keys's the prompt into the Claude REPL.
 *
 * Skips workhorses where:
 *   - tmuxAlive=false (no session to nudge)
 *   - lastClaudeBeat within last 5 min (Claude is mid-turn — let it
 *     finish; next tick will catch it).
 *   - an unread workhorse_tick directive is already pending for this
 *     (host, sessionName) channel (avoids stacking).
 */
async function workhorseTickAll(): Promise<Record<string, unknown>> {
  const projects = await prisma.project.findMany({
    where: { status: "active" },
    select: { id: true, title: true },
  });
  let queued = 0;
  let skippedNoAutonomy = 0;
  let skippedNotAlive = 0;
  let skippedRecentBeat = 0;
  let skippedAlreadyPending = 0;
  for (const p of projects) {
    const decision = await decideAutonomy(p.id, "workhorse_tick");
    if (decision !== "auto") {
      skippedNoAutonomy += 1;
      continue;
    }
    const workhorses = await prisma.workhorse.findMany({
      where: { projectId: p.id },
      select: {
        id: true,
        host: true,
        sessionName: true,
        configJson: true,
        lastClaudeBeat: true,
      },
    });
    for (const w of workhorses) {
      const tmuxAlive = parseTmuxAlive(w.configJson);
      if (tmuxAlive !== true) {
        skippedNotAlive += 1;
        continue;
      }
      const beat = w.lastClaudeBeat?.getTime() ?? 0;
      if (beat && Date.now() - beat < 5 * 60_000) {
        skippedRecentBeat += 1;
        continue;
      }
      const source = `dashboard@${w.host}:${w.sessionName}`;
      const existing = await prisma.agentMessage.findFirst({
        where: {
          projectId: p.id,
          kind: "directive",
          source,
          body: "workhorse_tick",
          readAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        skippedAlreadyPending += 1;
        continue;
      }
      await prisma.agentMessage.create({
        data: {
          projectId: p.id,
          kind: "directive",
          severity: "info",
          source,
          body: "workhorse_tick",
          payloadJson: null, // sync.py uses the default tick prompt
        },
      });
      queued += 1;
    }
  }
  return {
    queued,
    skippedNoAutonomy,
    skippedNotAlive,
    skippedRecentBeat,
    skippedAlreadyPending,
  };
}

function parseTmuxAlive(configJson: string | null): boolean | null {
  if (!configJson) return null;
  try {
    const c = JSON.parse(configJson) as { tmuxAlive?: unknown };
    return c.tmuxAlive === true ? true : c.tmuxAlive === false ? false : null;
  } catch {
    return null;
  }
}

const TICKS: Tick[] = [
  {
    kind: "wandb_pull",
    everyMs: 30 * 60 * 1000,
    run: async () => (await pullWandb()) as unknown as Record<string, unknown>,
  },
  {
    kind: "github_pull",
    everyMs: 60 * 60 * 1000,
    run: async () => (await pullGithub()) as unknown as Record<string, unknown>,
  },
  {
    kind: "stall_detect",
    everyMs: 60 * 60 * 1000,
    run: stallDetect,
  },
  {
    kind: "project_brain_global",
    everyMs: 60 * 60 * 1000,
    run: brainTick,
  },
  {
    kind: "workhorse_tick_global",
    everyMs: 30 * 60 * 1000,
    run: workhorseTickAll,
  },
];

declare global {
  // eslint-disable-next-line no-var
  var __sd_worker: { timers: NodeJS.Timeout[] } | undefined;
}

export function startWorker() {
  if (globalThis.__sd_worker) return globalThis.__sd_worker;
  const timers: NodeJS.Timeout[] = [];
  for (const t of TICKS) {
    // Light stagger so all three ticks don't fire at once on boot.
    const firstDelay = 5_000 + Math.floor(Math.random() * 20_000);
    timers.push(
      setTimeout(() => {
        void runTick(t);
        timers.push(setInterval(() => void runTick(t), t.everyMs));
      }, firstDelay),
    );
  }
  const heartbeat = setInterval(async () => {
    try {
      await prisma.jobRun.create({
        data: {
          kind: "other",
          startedAt: new Date(),
          endedAt: new Date(),
          ok: true,
          payloadJson: JSON.stringify({ heartbeat: true }),
        },
      });
    } catch {
      /* db might be locked briefly — not fatal */
    }
  }, 5 * 60 * 1000);
  timers.push(heartbeat);

  const graceful = async () => {
    const inflight = await prisma.jobRun.findMany({ where: { endedAt: null } });
    for (const j of inflight) {
      await prisma.jobRun
        .update({
          where: { id: j.id },
          data: { ok: false, error: "shutdown", endedAt: new Date() },
        })
        .catch(() => null);
    }
  };
  process.once("SIGTERM", () => void graceful());
  process.once("SIGINT", () => void graceful());

  globalThis.__sd_worker = { timers };
  return globalThis.__sd_worker;
}

export async function runJobOnce(kind: JobKind): Promise<void> {
  const t = TICKS.find((x) => x.kind === kind);
  if (!t) throw new Error(`unknown job: ${kind}`);
  await runTick(t);
}

/* ---------------- long-running agent job dispatch --------------- */

/**
 * In-memory registry of in-flight agent sessions keyed by JobRun.id.
 * /api/jobs/[id]/abort looks up the controller here and calls .abort()
 * so the Claude Agent SDK session winds down at its next safe point.
 * Registered automatically by `kickOffAgentJob`.
 */
const agentAborts: Map<string, AbortController> = (() => {
  const g = globalThis as unknown as {
    __sd_agent_aborts?: Map<string, AbortController>;
  };
  if (!g.__sd_agent_aborts) g.__sd_agent_aborts = new Map();
  return g.__sd_agent_aborts;
})();

export function getAgentAbort(jobId: string): AbortController | undefined {
  return agentAborts.get(jobId);
}

/**
 * Fire-and-forget dispatch for long-running agent tasks (repo quickstart,
 * anything else that streams). Not under `withMutex` — quickstart jobs
 * for different projects should run in parallel.
 *
 * The task closure receives the controller so it can pass its signal
 * down to the SDK. Errors inside the task are caught, logged on the
 * JobRun row, and don't unhandle-reject.
 */
export function kickOffAgentJob(
  jobId: string,
  task: (ctrl: AbortController) => Promise<void>,
): AbortController {
  const ctrl = new AbortController();
  agentAborts.set(jobId, ctrl);

  // Defer with queueMicrotask so the caller can return a response first.
  queueMicrotask(() => {
    task(ctrl)
      .catch(async (e) => {
        try {
          await prisma.jobRun.update({
            where: { id: jobId },
            data: {
              ok: false,
              error: (e instanceof Error ? e.message : String(e)).slice(0, 1000),
              endedAt: new Date(),
            },
          });
        } catch {
          // DB may already be in an unexpected state; worst-case leave the
          // JobRun open and the user can read the error from elsewhere.
        }
      })
      .finally(() => {
        agentAborts.delete(jobId);
      });
  });

  return ctrl;
}
