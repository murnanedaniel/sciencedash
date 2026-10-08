import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// A separate fixture database; no dashboard database or real Claude process is used.
test("RC lifecycle, tick gates, read tools and ambient ingest survive migration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sciencedash-rc-test-"));
  const path = join(dir, "test.db");
  const priorUrl = process.env.DATABASE_URL;
  const priorWake = process.env.SCIENCEDASH_BRIDGE_WAKE;
  process.env.DATABASE_URL = `file:${path}`;
  process.env.SCIENCEDASH_BRIDGE_WAKE = "0";
  const db = new Database(path);
  const migrations = new URL("../../../prisma/migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((n) => /^\d/.test(n)).sort()) {
    db.exec(readFileSync(new URL(`${name}/migration.sql`, migrations), "utf8"));
  }
  db.close();
  const { prisma } = await import("@/lib/prisma");
  try {
    const { callTool } = await import("@/lib/mcp/server");
    const { tickProjectWorkhorses } = await import("./tick");
    const { runReconcile } = await import("./runReconcile");
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await callTool(name, args);
      assert.ok(!result.isError, JSON.stringify(result.content));
      const first = result.content[0];
      assert.equal(first.type, "text");
      return JSON.parse((first as { text: string }).text);
    };
    await prisma.project.create({ data: { id: "p", title: "Research", status: "active" } });
    await prisma.project.create({ data: { id: "q", title: "Other", status: "active" } });
    await prisma.bridge.create({ data: { name: "perlmutter", envId: "env_1", lastBeat: new Date() } });
    const request = await prisma.agentMessage.create({ data: { projectId: "p", source: "reconciler@perlmutter", kind: "directive", body: "recreate_rc_workhorse" } });
    const register = { projectId: "p", bridgeName: "perlmutter", rcSessionId: "session_1", rcEnvId: "env_1", repo: "/repo" };
    const registrationStart = Date.now();
    const w = await call("register_rc_workhorse", register);
    assert.ok(new Date(w.registeredAt).getTime() >= registrationStart);
    assert.equal((await runReconcile()).wake, 0);
    const updated = await call("register_rc_workhorse", { ...register, rcSessionId: "session_2" });
    assert.equal(w.id, updated.id);
    assert.equal(updated.repo, "/repo");
    assert.equal(await prisma.workhorse.count(), 1);
    assert.ok((await prisma.agentMessage.findUniqueOrThrow({ where: { id: request.id } })).readAt);
    assert.equal((await call("get_entity", { kind: "workhorse", id: w.id })).state, "live");
    assert.equal((await call("query_entity", { kind: "workhorse", projectId: "p" }))[0].rcSessionId, "session_2");

    // Ask only alerts, deduplicated across ticks; never advances the tick timestamp.
    assert.equal((await tickProjectWorkhorses("p")).skippedNoAutonomy, 1);
    assert.equal((await tickProjectWorkhorses("p")).skippedNoAutonomy, 1);
    assert.equal(await prisma.agentMessage.count({ where: { source: "workhorse-tick", severity: "decision" } }), 1);
    assert.equal((await prisma.workhorse.findUniqueOrThrow({ where: { id: w.id } })).lastTickAt, null);

    await prisma.project.update({ where: { id: "p" }, data: { autonomyJson: JSON.stringify({ auto: ["workhorse_tick"] }), workhorseIntervalSec: 0 } });
    assert.equal((await tickProjectWorkhorses("p")).skippedPaused, 1);
    await prisma.project.update({ where: { id: "p" }, data: { workhorseIntervalSec: null } });
    assert.equal((await call("dispatch_workhorse", { projectId: "p" })).ticked, 1);
    assert.equal((await tickProjectWorkhorses("p")).skippedTempo, 1);
    assert.ok((await prisma.workhorse.findUniqueOrThrow({ where: { id: w.id } })).lastTickAt);

    await prisma.workhorse.update({ where: { id: w.id }, data: { lastTickAt: null } });
    await prisma.bridge.update({ where: { name: "perlmutter" }, data: { lastBeat: new Date(0) } });
    assert.equal((await tickProjectWorkhorses("p")).skippedBridgeDown, 1);
    assert.equal((await call("get_entity", { kind: "workhorse", id: w.id })).state, "bridge_down");
    await prisma.bridge.update({ where: { name: "perlmutter" }, data: { lastBeat: new Date() } });
    await prisma.project.update({ where: { id: "p" }, data: { autonomyJson: JSON.stringify({ propose: ["workhorse_tick"] }) } });
    assert.equal((await tickProjectWorkhorses("p")).skippedNoAutonomy, 1);
    assert.equal((await call("dispatch_workhorse", { projectId: "p" })).ticked, 1);
    assert.equal(await prisma.agentMessage.count({ where: { source: "workhorse-tick", severity: "suggestion" } }), 1);

    const other = await call("register_rc_workhorse", { ...register, projectId: "q" });
    const second = await call("register_rc_workhorse", { ...register, bridgeName: "another" });
    assert.equal((await call("stop_all_workhorses", { projectId: "p", bridgeName: "another" })).stopped, 1);
    assert.equal((await prisma.workhorse.findUniqueOrThrow({ where: { id: w.id } })).rcState, "live");
    assert.equal((await call("stop_all_workhorses", { projectId: "p" })).stopped, 2);
    assert.equal((await prisma.workhorse.findUniqueOrThrow({ where: { id: other.id } })).rcState, "live");
    const missing = await callTool("dispatch_workhorse", { projectId: "p" });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.content), /No live RC workhorse/);
    assert.equal((await call("stop_all_workhorses", {})).stopped, 3);
    assert.ok(Object.values(await runReconcile()).every((n) => n === 0));
    await prisma.workhorse.update({ where: { id: w.id }, data: { wakeCount: 8 } });
    const resumeStart = Date.now();
    assert.equal((await call("resume_workhorse", { projectId: "p", bridgeName: "perlmutter" })).resumed, 1);
    assert.equal((await prisma.workhorse.findUniqueOrThrow({ where: { id: w.id } })).wakeCount, 0);
    assert.equal((await prisma.workhorse.findUniqueOrThrow({ where: { id: second.id } })).rcState, "stopped");
    assert.ok((await prisma.workhorse.findUniqueOrThrow({ where: { id: w.id } })).registeredAt!.getTime() >= resumeStart);
    assert.equal((await runReconcile()).wake, 0);
    await prisma.workhorse.update({ where: { id: w.id }, data: { registeredAt: new Date(Date.now() - 3 * 60_000) } });
    assert.equal((await runReconcile()).wake, 1);
    assert.equal((await prisma.workhorse.findUniqueOrThrow({ where: { id: w.id } })).rcState, "waking");
    await prisma.bridge.update({ where: { name: "perlmutter" }, data: { envId: "env_2" } });
    assert.equal((await runReconcile()).request_recreate, 1);
    assert.equal(await prisma.agentMessage.count({ where: { projectId: "p", kind: "directive", body: "recreate_rc_workhorse", readAt: null } }), 1);
    assert.equal((await call("remove_workhorse", { id: w.id })).removed, true);
    assert.equal(await prisma.workhorse.count(), 2);

    // The unchanged ambient endpoint still writes turns and maintains its search index.
    const { POST } = await import("@/app/api/ingest/transcript/route");
    const { NextRequest } = await import("next/server");
    const body = { machine: "test", sessionId: "ambient-test", cwd: "/research/fixture", fromLine: 0, totalLines: 1, events: [{ role: "user", text: "ambient regression sentinel" }] };
    const ingest = () => POST(new NextRequest("http://localhost/api/ingest/transcript", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    assert.equal((await (await ingest()).json()).appended, 1);
    assert.equal((await (await ingest()).json()).appended, 0);
    assert.equal(await prisma.thread.count(), 1);
    assert.equal(await prisma.turn.count(), 1);
    const matches = await prisma.$queryRawUnsafe<Array<{ n: number }>>("SELECT COUNT(*) AS n FROM ThreadFTS WHERE ThreadFTS MATCH 'sentinel'");
    assert.equal(Number(matches[0].n), 1);
  } finally {
    await prisma.$disconnect();
    if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    if (priorWake === undefined) delete process.env.SCIENCEDASH_BRIDGE_WAKE; else process.env.SCIENCEDASH_BRIDGE_WAKE = priorWake;
    rmSync(dir, { recursive: true, force: true });
  }
});
