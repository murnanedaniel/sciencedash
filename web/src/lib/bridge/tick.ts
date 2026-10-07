import { prisma } from "@/lib/prisma";
import { decideAutonomy } from "@/lib/brain/autonomy";
import { wakeSession } from "./wake";
import { DEFAULT_WORKHORSE_INTERVAL_SEC, tickSkipReason } from "./workhorseState";

export const emptyTickCounts = () => ({
  ticked: 0, failed: 0, skippedNoAutonomy: 0, skippedPaused: 0,
  skippedNotLive: 0, skippedBridgeDown: 0, skippedTempo: 0,
});

export async function tickProjectWorkhorses(projectId: string, options: {
  bridgeName?: string; actionClass?: string; reason?: string; manual?: boolean;
} = {}) {
  const counts = emptyTickCounts();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const workhorses = await prisma.workhorse.findMany({
    where: { projectId, ...(options.bridgeName ? { bridgeName: options.bridgeName } : {}) },
  });
  if (options.manual && !workhorses.some((w) => w.rcState === "live")) {
    throw new Error("No live RC workhorse for this project. Start a session on a bridge and call register_rc_workhorse, or resume a stopped workhorse.");
  }
  const actionClass = options.actionClass ?? "workhorse_tick";
  const decision = await decideAutonomy(projectId, actionClass);
  const intervalSec = project.workhorseIntervalSec ?? DEFAULT_WORKHORSE_INTERVAL_SEC;
  if (intervalSec <= 0) {
    counts.skippedPaused++;
    return { ...counts, decision };
  }
  if (decision === "ask") {
    // Keep one outstanding permission request per policy/bridge scope.
    const payloadJson = JSON.stringify({ actionClass, bridgeName: options.bridgeName ?? null });
    const existing = await prisma.agentMessage.findFirst({ where: {
      projectId, source: "workhorse-tick", kind: "alert", severity: "decision", readAt: null, payloadJson,
    } });
    if (!existing && workhorses.length) await prisma.agentMessage.create({ data: {
      projectId, source: "workhorse-tick", kind: "alert", severity: "decision", payloadJson,
      body: `**Permission needed** — tick the RC workhorse for "${project.title}"? (action class: ${actionClass}) ${options.reason ?? ""}`,
    } });
    counts.skippedNoAutonomy++;
    return { ...counts, decision };
  }
  // Scheduled ticks retain auto-only gating. Explicit dispatch permits propose.
  if (decision !== "auto" && !options.manual) {
    counts.skippedNoAutonomy++;
    return { ...counts, decision };
  }
  const bridges = await prisma.bridge.findMany();
  const byName = new Map(bridges.map((b) => [b.name, { ...b, liveSessions: [] }]));
  for (const w of workhorses) {
    const now = new Date();
    const skip = tickSkipReason(w, byName.get(w.bridgeName), now, intervalSec);
    if (skip) { counts[skip]++; continue; }
    // Claim this interval atomically so manual dispatch and the worker cannot double-tick.
    const claim = await prisma.workhorse.updateMany({
      where: { id: w.id, rcState: "live", lastTickAt: w.lastTickAt },
      data: { lastTickAt: now },
    });
    if (!claim.count) { counts.skippedTempo++; continue; }
    const message = `ScienceDash tick for project "${project.title}" (${projectId}): check the project brief and recent check-ins via the sciencedash skill, do the next step if there is one, post a check-in, then stop. If nothing to do, reply "idle".`;
    const result = await wakeSession(w.rcSessionId, message);
    if (result.ok) counts.ticked++;
    else {
      counts.failed++;
      await prisma.agentMessage.create({ data: {
        projectId, source: "workhorse-tick", kind: "alert", severity: "warn",
        body: `RC tick failed for ${w.rcSessionId}: ${result.detail}`,
      } });
    }
    if (decision === "propose") await prisma.agentMessage.create({ data: {
      projectId, source: "workhorse-tick", kind: "alert", severity: "suggestion",
      body: `RC tick ${result.ok ? "sent" : "failed"} on ${w.bridgeName} (action class: ${actionClass}). ${options.reason ?? ""}`,
    } });
  }
  return { ...counts, decision };
}
