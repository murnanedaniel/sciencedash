import { bridgeStatus, type BridgeView } from "./reconcile";

export type WorkhorseState = "live" | "waking" | "needs_recreate" | "stopped" | "bridge_down";

export function deriveWorkhorseState(
  rcState: string | null, bridge: BridgeView | undefined, now: Date,
): WorkhorseState {
  if (rcState === "stopped") return "stopped";
  if (!bridge || bridgeStatus(bridge, now) !== "fresh") return "bridge_down";
  if (rcState === "live" || rcState === "waking") return rcState;
  return "needs_recreate";
}

export const DEFAULT_WORKHORSE_INTERVAL_SEC = 3600;

export function tickSkipReason(
  w: { rcState: string | null; lastTickAt: Date | null },
  bridge: BridgeView | undefined, now: Date, intervalSec: number,
): "skippedNotLive" | "skippedBridgeDown" | "skippedTempo" | null {
  if (w.rcState !== "live") return "skippedNotLive";
  if (!bridge || bridgeStatus(bridge, now) !== "fresh") return "skippedBridgeDown";
  if (w.lastTickAt && now.getTime() - w.lastTickAt.getTime() < intervalSec * 1000) return "skippedTempo";
  return null;
}
