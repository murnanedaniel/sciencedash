export type BridgeView = {
  name: string;
  envId: string | null;
  lastBeat: Date | null;
  liveSessions: string[];
  downAlertedAt: Date | null;
};
export type WorkhorseView = {
  id: string;
  projectId: string;
  projectTitle: string;
  active: boolean;
  bridgeName: string;
  rcSessionId: string;
  rcEnvId: string | null;
  rcState: string | null;
  registeredAt: Date | null;
  lastWakeAt: Date | null;
  wakeCount: number;
  recreateRequestedAt: Date | null;
};
export type Action =
  | { type: "mark_live"; workhorseId: string }
  | { type: "wake"; workhorseId: string; sessionId: string }
  | { type: "request_recreate"; workhorseId: string; reason: string }
  | { type: "alert_bridge_down"; bridgeName: string; minutesDown: number }
  | { type: "clear_bridge_alert"; bridgeName: string };

const MINUTE = 60_000;

export function sameSession(a: string, b: string): boolean {
  return a.replace(/^(session_|cse_)/, "") === b.replace(/^(session_|cse_)/, "");
}

export function bridgeStatus(b: BridgeView, now: Date): "fresh" | "stale" | "down" {
  if (!b.lastBeat) return "down";
  const age = now.getTime() - b.lastBeat.getTime();
  return age < 3 * MINUTE ? "fresh" : age < 15 * MINUTE ? "stale" : "down";
}

export function decideReconcile(
  bridges: BridgeView[], workhorses: WorkhorseView[], now: Date,
): Action[] {
  const actions: Action[] = [];
  const byName = new Map(bridges.map((b) => [b.name, b]));
  for (const b of bridges) {
    const status = bridgeStatus(b, now);
    // A missing beat establishes no duration. Wait for a dated heartbeat
    // before claiming the bridge has been down for thirty minutes.
    const age = b.lastBeat ? now.getTime() - b.lastBeat.getTime() : null;
    if (status === "down" && age !== null && age >= 30 * MINUTE && !b.downAlertedAt) {
      actions.push({ type: "alert_bridge_down", bridgeName: b.name, minutesDown: Math.floor(age / MINUTE) });
    } else if (status === "fresh" && b.downAlertedAt) {
      actions.push({ type: "clear_bridge_alert", bridgeName: b.name });
    }
  }
  for (const w of workhorses) {
    if (w.rcState === "stopped" || !w.active || !w.bridgeName || !w.rcSessionId) continue;
    const b = byName.get(w.bridgeName);
    if (!b || bridgeStatus(b, now) !== "fresh") continue;
    const isLive = b.liveSessions.some((s) => sameSession(s, w.rcSessionId));
    // Allow heartbeats time to discover a newly registered or resumed session.
    if (!isLive && w.registeredAt && now.getTime() - w.registeredAt.getTime() < 3 * MINUTE) continue;
    const recreate = (reason: string) => {
      if (!w.recreateRequestedAt || now.getTime() - w.recreateRequestedAt.getTime() > 6 * 60 * MINUTE) {
        actions.push({ type: "request_recreate", workhorseId: w.id, reason });
      }
    };
    if (b.envId !== w.rcEnvId) {
      recreate(`env changed ${w.rcEnvId}→${b.envId}`);
    } else if (isLive) {
      if (w.rcState !== "live" || w.wakeCount > 0) {
        actions.push({ type: "mark_live", workhorseId: w.id });
      }
    } else if (w.wakeCount >= 8) {
      recreate("unresponsive after 8 wakes");
    } else if (!w.lastWakeAt || now.getTime() - w.lastWakeAt.getTime() >= Math.min(5 * MINUTE * 2 ** w.wakeCount, 60 * MINUTE)) {
      actions.push({ type: "wake", workhorseId: w.id, sessionId: w.rcSessionId });
    }
  }
  return actions;
}
