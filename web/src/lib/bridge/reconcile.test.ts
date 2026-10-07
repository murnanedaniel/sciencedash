import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeStatus, decideReconcile, sameSession, type BridgeView, type WorkhorseView } from "./reconcile";

const now = new Date("2026-10-07T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const bridge: BridgeView = { name: "perlmutter", envId: "env_1", lastBeat: now, liveSessions: [], downAlertedAt: null };
const wh: WorkhorseView = {
  id: "w1", projectId: "p1", projectTitle: "Research", active: true,
  bridgeName: bridge.name, rcSessionId: "session_01X", rcEnvId: "env_1",
  rcState: "orphaned", lastWakeAt: null, wakeCount: 0, recreateRequestedAt: null,
};
const decide = (b: Partial<BridgeView> = {}, w: Partial<WorkhorseView> = {}) =>
  decideReconcile([{ ...bridge, ...b }], [{ ...wh, ...w }], now);
const wake = [{ type: "wake", workhorseId: wh.id, sessionId: wh.rcSessionId }];
const recreate = (reason: string) => [{ type: "request_recreate", workhorseId: wh.id, reason }];

test("bridge freshness thresholds, including no heartbeat", () => {
  for (const [age, expected] of [[0, "fresh"], [2.999, "fresh"], [3, "stale"], [14.999, "stale"], [15, "down"], [30, "down"]] as const) {
    assert.equal(bridgeStatus({ ...bridge, lastBeat: ago(age) }, now), expected);
  }
  assert.equal(bridgeStatus({ ...bridge, lastBeat: null }, now), "down");
});
test("session ids compare suffixes after either prefix", () => {
  assert.equal(sameSession("session_01X", "cse_01X"), true);
  assert.equal(sameSession("cse_01X", "session_01X"), true);
  assert.equal(sameSession("session_01X", "session_01X"), true);
  assert.equal(sameSession("session_01X", "cse_01Y"), false);
  assert.equal(sameSession("other_session_01X", "cse_01X"), false);
});
test("changed environment requests recreation before checking liveness", () => {
  assert.deepEqual(decide({ envId: "env_2", liveSessions: ["cse_01X"] }), recreate("env changed env_1→env_2"));
  assert.deepEqual(decide({ envId: null }), recreate("env changed env_1→null"));
});
test("recreation dedupes for six hours for both reasons", () => {
  for (const [b, w, reason] of [
    [{ envId: "env_2" }, {}, "env changed env_1→env_2"],
    [{}, { wakeCount: 8 }, "unresponsive after 8 wakes"],
  ] as const) {
    for (const age of [0, 359, 360]) assert.deepEqual(decide(b, { ...w, recreateRequestedAt: ago(age) }), []);
    assert.deepEqual(decide(b, { ...w, recreateRequestedAt: ago(360.001) }), recreate(reason));
  }
});
test("live sessions reset state or wake count, otherwise no action", () => {
  const b = { liveSessions: ["cse_other", "cse_01X"] };
  assert.deepEqual(decide(b), [{ type: "mark_live", workhorseId: wh.id }]);
  assert.deepEqual(decide(b, { rcState: "live" }), []);
  assert.deepEqual(decide(b, { rcState: "live", wakeCount: 8 }), [{ type: "mark_live", workhorseId: wh.id }]);
});
test("orphaned sessions wake immediately without a previous wake", () => {
  assert.deepEqual(decide(), wake);
  assert.deepEqual(decide({}, { wakeCount: 7 }), wake);
});
test("exponential backoff includes the boundary and caps at sixty minutes", () => {
  for (let n = 0; n < 8; n++) {
    const delay = Math.min(5 * 2 ** n, 60);
    assert.deepEqual(decide({}, { wakeCount: n, lastWakeAt: ago(delay - 0.001) }), []);
    assert.deepEqual(decide({}, { wakeCount: n, lastWakeAt: ago(delay) }), wake);
  }
});
test("eight or more unsuccessful wakes request recreation, never wake", () => {
  for (const wakeCount of [8, 9, 100]) {
    assert.deepEqual(decide({}, { wakeCount }), recreate("unresponsive after 8 wakes"));
  }
});
test("down alert starts at thirty minutes and dedupes", () => {
  assert.deepEqual(decide({ lastBeat: ago(29.999) }), []);
  assert.deepEqual(decide({ lastBeat: ago(30) }), [{ type: "alert_bridge_down", bridgeName: bridge.name, minutesDown: 30 }]);
  assert.deepEqual(decide({ lastBeat: ago(31.5) }), [{ type: "alert_bridge_down", bridgeName: bridge.name, minutesDown: 31 }]);
  assert.deepEqual(decide({ lastBeat: ago(45), downAlertedAt: ago(15) }), []);
  assert.deepEqual(decide({ lastBeat: null }), []);
});
test("fresh recovery clears the alert; stale does not", () => {
  assert.deepEqual(decide({ downAlertedAt: ago(30) }, { active: false }), [{ type: "clear_bridge_alert", bridgeName: bridge.name }]);
  assert.deepEqual(decide({ lastBeat: ago(3), downAlertedAt: ago(30) }), []);
});
test("inactive or unregistered workhorses are skipped", () => {
  for (const w of [{ active: false }, { bridgeName: "" }, { rcSessionId: null }, { bridgeName: "missing" }]) {
    assert.deepEqual(decide({}, w), []);
  }
});
test("not-fresh bridges suppress every workhorse action", () => {
  for (const lastBeat of [null, ago(3), ago(15)]) {
    for (const w of [{}, { rcEnvId: "env_old" }, { wakeCount: 8 }]) {
      assert.deepEqual(decide({ lastBeat, liveSessions: ["cse_01X"] }, w), []);
    }
  }
});
test("sessions are matched only on their own bridge", () => {
  assert.deepEqual(decideReconcile([bridge, { ...bridge, name: "other", liveSessions: ["cse_01X"] }], [wh], now), wake);
  assert.deepEqual(decideReconcile([], [wh], now), []);
});
