/**
 * Global brain orchestrator — runs per-project heartbeats across all
 * "active" projects in sequence (sequential to keep costs predictable).
 *
 * V1 is a thin loop, not a meta-Claude. The aggregation surface is the
 * DigestPanel on /today, which sorts unread AgentMessages across
 * projects by severity. A future iteration can add a meta-Claude pass
 * that writes a digest summary message of its own.
 */

import { prisma } from "@/lib/prisma";
import { runHeartbeat, type HeartbeatResult } from "@/lib/brain/heartbeat";

export type GlobalHeartbeatResult = {
  ran: number;
  skipped: number;
  failed: number;
  totalCostUsd: number;
  perProject: Array<{
    projectId: string;
    title: string;
    result: HeartbeatResult;
  }>;
};

export async function runGlobalHeartbeat(opts: { force?: boolean } = {}): Promise<GlobalHeartbeatResult> {
  const projects = await prisma.project.findMany({
    where: { status: "active" },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });

  let ran = 0;
  let skipped = 0;
  let failed = 0;
  let totalCostUsd = 0;
  const perProject: GlobalHeartbeatResult["perProject"] = [];

  for (const p of projects) {
    const result = await runHeartbeat(p.id, { force: opts.force === true });
    perProject.push({ projectId: p.id, title: p.title, result });
    if (!result.ok) {
      failed++;
    } else if ("skipped" in result && result.skipped) {
      skipped++;
    } else {
      ran++;
      if ("costUsd" in result && typeof result.costUsd === "number") {
        totalCostUsd += result.costUsd;
      }
    }
  }

  return { ran, skipped, failed, totalCostUsd, perProject };
}
