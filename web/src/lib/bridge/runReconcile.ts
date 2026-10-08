import { prisma } from "@/lib/prisma";
import { callTool } from "@/lib/mcp/server";
import { decideReconcile, type Action } from "./reconcile";
import { wakeSession } from "./wake";

async function postMessage(projectId: string, source: string, body: string, severity: "warn" | "blocker" | "info") {
  const result = await callTool("post_message", { projectId, source, body, severity, kind: "alert" });
  if (result.isError) throw new Error(JSON.stringify(result.content));
}

export async function runReconcile(): Promise<Record<Action["type"], number>> {
  const [rows, workhorses] = await Promise.all([
    prisma.bridge.findMany(),
    prisma.workhorse.findMany({
      include: { project: { select: { title: true, status: true, workhorseIntervalSec: true } } },
    }),
  ]);
  const now = new Date();
  const bridges = rows.map((b) => ({ ...b, liveSessions: JSON.parse(b.liveSessions) as string[] }));
  const actions = decideReconcile(bridges, workhorses.map((w) => ({
    ...w,
    registeredAt: w.registeredAt,
    projectTitle: w.project.title,
    active: w.project.status === "active" && w.project.workhorseIntervalSec !== 0,
  })), now);
  const counts: Record<Action["type"], number> = {
    mark_live: 0, wake: 0, request_recreate: 0, alert_bridge_down: 0, clear_bridge_alert: 0,
  };
  for (const action of actions) {
    if (action.type === "alert_bridge_down" || action.type === "clear_bridge_alert") {
      // AgentMessage requires a project. Keep infrastructure notices in a
      // stable, parked system project, outside the active autonomy loops.
      const system = await prisma.project.upsert({
        where: { id: "sciencedash-system" },
        create: { id: "sciencedash-system", title: "ScienceDash system", status: "parked" },
        update: {},
      });
      const down = action.type === "alert_bridge_down";
      await postMessage(system.id, `reconciler@${action.bridgeName}`,
        down ? `Bridge ${action.bridgeName} down ${action.minutesDown} min` : `Bridge ${action.bridgeName} recovered`,
        down ? "blocker" : "info");
      await prisma.bridge.update({
        where: { name: action.bridgeName }, data: { downAlertedAt: down ? now : null },
      });
    } else {
      const w = workhorses.find((w) => w.id === action.workhorseId)!;
      // A Stop/Remove/registration may have happened since the snapshot was read.
      const current = await prisma.workhorse.findUnique({ where: { id: w.id } });
      if (!current || current.rcState === "stopped" || current.rcSessionId !== w.rcSessionId) continue;
      const unchanged = { id: w.id, rcState: current.rcState, rcSessionId: w.rcSessionId };
      const source = `reconciler@${w.bridgeName}`;
      if (action.type === "mark_live") {
        const result = await prisma.workhorse.updateMany({ where: unchanged, data: { rcState: "live", wakeCount: 0 } });
        if (!result.count) continue;
      } else if (action.type === "wake") {
        const message = `ScienceDash wake (bridge restarted). You are the workhorse for project "${w.project.title}" (${w.projectId}). Re-orient from the project brief via the sciencedash skill, then continue your loop. If you have nothing to do, reply "idle" and stop.`;
        const result = await wakeSession(action.sessionId, message);
        const updated = await prisma.workhorse.updateMany({
          where: unchanged,
          data: { rcState: "waking", lastWakeAt: now, wakeCount: { increment: 1 } },
        });
        if (!updated.count) continue;
        if (!result.ok) await postMessage(w.projectId, source, `RC wake failed for ${action.sessionId}: ${result.detail}`, "warn");
      } else {
        const bridge = bridges.find((b) => b.name === w.bridgeName)!;
        const requested = await prisma.$transaction(async (tx) => {
          const updated = await tx.workhorse.updateMany({ where: unchanged, data: { rcState: "needs_recreate", recreateRequestedAt: now } });
          if (!updated.count) return false;
          await tx.agentMessage.create({ data: {
            projectId: w.projectId, source, kind: "directive", body: "recreate_rc_workhorse",
            payloadJson: JSON.stringify({ bridgeName: w.bridgeName, envId: bridge.envId, projectId: w.projectId, oldSessionId: w.rcSessionId }),
          } });
          return true;
        });
        if (!requested) continue;
        await postMessage(w.projectId, source, `RC workhorse needs recreation: ${action.reason}`, "warn");
      }
    }
    counts[action.type] += 1;
  }
  return counts;
}
