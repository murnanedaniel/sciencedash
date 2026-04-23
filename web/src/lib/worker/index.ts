import { prisma } from "@/lib/prisma";
import { withMutex } from "@/lib/worker/mutex";
import { pullWandb } from "@/lib/ingest/wandb";
import { pullGithub } from "@/lib/ingest/github";
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
