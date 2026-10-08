import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWorkhorseState, tickSkipReason } from "./workhorseState";
import type { BridgeView } from "./reconcile";

const now = new Date("2026-10-07T12:00:00Z");
const bridge: BridgeView = { name: "perlmutter", envId: "env_1", lastBeat: now, liveSessions: [], downAlertedAt: null };
const w = { rcState: "live", lastTickAt: null };

test("workhorse state reflects RC state and bridge freshness, preserving stopped", () => {
  for (const state of ["live", "waking", "needs_recreate", "stopped"] as const) {
    assert.equal(deriveWorkhorseState(state, bridge, now), state);
    assert.equal(deriveWorkhorseState(state, undefined, now), state === "stopped" ? "stopped" : "bridge_down");
  }
  assert.equal(deriveWorkhorseState(null, bridge, now), "needs_recreate");
  assert.equal(deriveWorkhorseState("live", { ...bridge, lastBeat: new Date(now.getTime() - 180_000) }, now), "bridge_down");
});

test("ticks skip non-live workhorses, stale/missing bridges and recent ticks", () => {
  for (const rcState of [null, "stopped", "waking", "needs_recreate"]) {
    assert.equal(tickSkipReason({ ...w, rcState }, bridge, now, 3600), "skippedNotLive");
  }
  assert.equal(tickSkipReason(w, undefined, now, 3600), "skippedBridgeDown");
  assert.equal(tickSkipReason(w, { ...bridge, lastBeat: new Date(now.getTime() - 180_000) }, now, 3600), "skippedBridgeDown");
  assert.equal(tickSkipReason({ ...w, lastTickAt: new Date(now.getTime() - 3599_999) }, bridge, now, 3600), "skippedTempo");
  assert.equal(tickSkipReason({ ...w, lastTickAt: new Date(now.getTime() - 3600_000) }, bridge, now, 3600), null);
  assert.equal(tickSkipReason(w, bridge, now, 3600), null);
});
