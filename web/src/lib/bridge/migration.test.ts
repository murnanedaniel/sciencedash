import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

test("RC migration preserves rows, fallback bridge identity, repo and unrelated data", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE Project (id TEXT PRIMARY KEY);
      INSERT INTO Project VALUES ('p');
      CREATE TABLE Thread (id TEXT PRIMARY KEY, bodyText TEXT);
      INSERT INTO Thread VALUES ('t', 'ambient transcript');
    `);
    const migration = (name: string) => readFileSync(new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
    db.exec(migration("20260426010000_m9_workhorses"));
    db.exec(migration("20261007000000_w8_rc_transport"));
    const insert = (values: Record<string, unknown>) => {
      // Supply placeholders for required historical fields from the actual old schema.
      const columns = db.pragma("table_info(Workhorse)") as Array<{ name: string; notnull: number; dflt_value: unknown }>;
      for (const c of columns) {
        if (c.notnull && c.dflt_value === null && !(c.name in values)) values[c.name] = values.id;
      }
      db.prepare(`INSERT INTO Workhorse (${Object.keys(values).map((k) => `"${k}"`).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
    };
    insert({ id: "old", projectId: "p", host: "old-host", transport: "tmux" });
    insert({ id: "rc1", projectId: "p", host: "fallback", transport: "rc", rcSessionId: "session_1", rcState: "live", configJson: '{"repo":"/repo"}' });
    insert({ id: "rc2", projectId: "p", host: "ignored", bridgeName: "named", transport: "rc", rcSessionId: "session_2", rcState: "waking", configJson: "invalid JSON", wakeCount: 3 });
    db.exec(readFileSync(new URL("../../../prisma/migrations/20261007120000_remove_sync_transport/migration.sql", import.meta.url), "utf8"));
    assert.deepEqual(db.prepare("SELECT id, bridgeName, rcSessionId, rcState, repo, wakeCount, lastTickAt, registeredAt FROM Workhorse ORDER BY id").all(), [
      { id: "rc1", bridgeName: "fallback", rcSessionId: "session_1", rcState: "live", repo: "/repo", wakeCount: 0, lastTickAt: null, registeredAt: null },
      { id: "rc2", bridgeName: "named", rcSessionId: "session_2", rcState: "waking", repo: null, wakeCount: 3, lastTickAt: null, registeredAt: null },
    ]);
    assert.deepEqual(db.prepare("SELECT * FROM Thread").all(), [{ id: "t", bodyText: "ambient transcript" }]);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.throws(() => db.exec("INSERT INTO Workhorse (id, projectId, bridgeName, rcSessionId) VALUES ('dup', 'p', 'named', 'session_3')"), /UNIQUE/);
  } finally {
    db.close();
  }
});
