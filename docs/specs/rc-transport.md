# Spec: Remote Control transport for workhorses (W8, phase 1)

Status: ready to implement on branch `w8-rc-transport`. **Do not push to main**, because main auto-deploys to production.

## Why
Workhorses on Perlmutter currently depend on `sync.py`, tmux and directives, all running on a single login node. That path has been dead since 2026-06-17. Claude Code Remote Control ("rc") bridges replace it:

- A **scrontab keeper** on Perlmutter runs `claude rc` as a Slurm `cron` QOS job. The bridge is named `perlmutter`.
- Slurm restarts the keeper within about 5 minutes of a node failure, on any login node, and it keeps the **same environment id** if it restarts within about 4 hours. This has been validated.
- After a restart, sessions that are not the pointer session stay idle until they receive a message. Sending one re-queues them with their memory intact (validated).
- `claude -p "<msg>" --cloud <session_id> --output-format json` delivers a message to a bridge session from a plain shell on homebox. It returns `{"ok":true,...}` (validated).
- **Creating** a session on an rc environment is not possible from the CLI. Only a Claude session's remote MCP tools can do it. Phase 1 therefore records creation requests and alerts the user; it does not create sessions itself.

ScienceDash's job in phase 1: **know the bridge's health, notice orphaned rc workhorses, and wake them automatically.** When the environment changed (an outage longer than 4 hours), raise a recreate request and alert the user.

Keep the existing tmux/sync.py path working unchanged. This is additive.

## 1. Data model (`web/prisma/schema.prisma` plus a new migration)
New model:
```prisma
model Bridge {
  id            String   @id @default(cuid())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  name          String   @unique      // "perlmutter" — stable key; env ids can change
  envId         String?               // env_… from bridge-pointer.json
  node          String?               // login node hostname, e.g. "login32"
  jobId         String?               // Slurm job id
  rcAlive       Boolean  @default(false)
  claudeVersion String?
  liveSessions  String   @default("[]") // JSON array of session ids seen as live worker processes (cse_… form)
  lastBeat      DateTime?
  downAlertedAt DateTime?             // dedupe: set when a "bridge down" alert is posted, cleared when fresh again
  configJson    String?               // raw last heartbeat payload (debugging)
}
```
New fields on `Workhorse`, all optional or defaulted so existing rows keep working:
```prisma
  transport           String    @default("tmux") // "tmux" | "rc"
  bridgeName          String?                    // FK-by-name to Bridge.name (no relation needed)
  rcSessionId         String?                    // session_… or cse_… id of the rc session
  rcEnvId             String?                    // env id the session belongs to
  rcState             String?                    // "live" | "orphaned" | "waking" | "needs_recreate"
  lastWakeAt          DateTime?
  wakeCount           Int       @default(0)
  recreateRequestedAt DateTime?
```
Add `bridge_reconcile` to `enum JobKind`. Write a proper migration under `web/prisma/migrations/` following the existing naming style. It must apply cleanly with `prisma migrate deploy` to the existing SQLite DB.

## 2. Heartbeat endpoint: `POST /api/bridge/heartbeat`
- **Auth:** bearer, through the existing `proxy.ts`/`verifyBearer` path. Check how other `/api/mcp/*` routes are protected and match them.
- **Body (JSON):** `{ name: string, envId?: string, node?: string, jobId?: string, rcAlive: boolean, claudeVersion?: string, liveSessions?: string[] }`
- **Behaviour:** validate (`name` must match `/^[a-z0-9-]{1,40}$/` and `liveSessions` must have at most 200 entries), upsert `Bridge` by `name`, set `lastBeat = now`, and store the raw payload in `configJson`.
- **Response:** `{ ok: true }`.

## 3. Reconciler
### 3a. Pure decision function: `web/src/lib/bridge/reconcile.ts`
```ts
export type BridgeView = { name: string; envId: string | null; lastBeat: Date | null; liveSessions: string[]; downAlertedAt: Date | null };
export type WorkhorseView = { id: string; projectId: string; projectTitle: string; active: boolean; bridgeName: string; rcSessionId: string | null; rcEnvId: string | null; rcState: string | null; lastWakeAt: Date | null; wakeCount: number; recreateRequestedAt: Date | null };
export type Action =
  | { type: "mark_live"; workhorseId: string }
  | { type: "wake"; workhorseId: string; sessionId: string }
  | { type: "request_recreate"; workhorseId: string; reason: string }
  | { type: "alert_bridge_down"; bridgeName: string; minutesDown: number }
  | { type: "clear_bridge_alert"; bridgeName: string };
export function bridgeStatus(b: BridgeView, now: Date): "fresh" | "stale" | "down";
export function decideReconcile(bridges: BridgeView[], workhorses: WorkhorseView[], now: Date): Action[];
export function sameSession(a: string, b: string): boolean; // compares the id suffix after "session_" / "cse_"
```
Rules:
- **Bridge status:** `fresh` if `lastBeat` is less than 3 min old, `stale` if under 15 min, otherwise `down` (including when it's null).
- **Bridge down for 30 min or more** with `downAlertedAt` null → `alert_bridge_down`. When the bridge is `fresh` and `downAlertedAt` is set → `clear_bridge_alert`.
- **Skip** workhorses that are inactive, have no `bridgeName`, or have no `rcSessionId`.
- **Bridge not fresh** → no workhorse actions; the keeper is responsible for recovering the bridge.
- **Bridge fresh but `envId` differs from `wh.rcEnvId`:**
  - If `recreateRequestedAt` is null or older than 6 h → `request_recreate` with reason `"env changed <old>→<new>"`.
  - Otherwise do nothing (deduplicated).
- **Bridge fresh, `envId` matches, and the session is in `liveSessions`** (compare with `sameSession`) → `mark_live`, but only if `rcState !== "live"` or `wakeCount > 0`.
- **Bridge fresh, `envId` matches, session not live** → `wake` if `lastWakeAt` is null or `now - lastWakeAt >= backoff(wakeCount)`.
  - `backoff(n) = min(5 min × 2^n, 60 min)`.
  - Never wake when `wakeCount >= 8`. Instead, emit `request_recreate` with reason `"unresponsive after 8 wakes"`, deduplicated as above.

### 3b. Executor: `web/src/lib/bridge/runReconcile.ts`
- Load the bridges and the `transport = "rc"` workhorses, with project title and active flag. `active` means project `status === "active"` and `workhorseIntervalSec !== 0`.
- Call `decideReconcile`, then carry out each action:
  - **`mark_live`:** `rcState = "live"`, `wakeCount = 0`.
  - **`wake`:** call `wakeSession(sessionId, message)` (see 3c). On ok, set `rcState = "waking"`, `lastWakeAt = now` and `wakeCount += 1`. On failure, do the same and also post a `warn` AgentMessage via the existing `post_message` path. The message text:
    > `ScienceDash wake (bridge restarted). You are the workhorse for project "<title>" (<projectId>). Re-orient from the project brief via the sciencedash skill, then continue your loop. If you have nothing to do, reply "idle" and stop.`
  - **`request_recreate`:** set `rcState = "needs_recreate"` and `recreateRequestedAt = now`. Create an `AgentMessage` with `kind = directive`, `body = "recreate_rc_workhorse"`, payload `{bridgeName, envId, projectId, oldSessionId}` and source `reconciler@<bridgeName>`. Also post a `warn` message to the project so the user sees it.
  - **`alert_bridge_down`:** post a `critical` (or the highest existing severity) global or system message saying "Bridge <name> down <n> min", and set `downAlertedAt`.
  - **`clear_bridge_alert`:** set `downAlertedAt = null`, and post an `info` message saying it recovered.
- Return counts per action type, for the JobRun summary.
- Register it in the `TICKS` array in `web/src/lib/worker/index.ts` as `{ kind: "bridge_reconcile", everyMs: 60_000, run: runReconcile }`.

### 3c. Waking a session: `web/src/lib/bridge/wake.ts`
- `wakeSession(sessionId, message): Promise<{ ok: boolean; detail: string }>`
- Use `resolveClaudePath()` from `web/src/lib/ai/agentClient.ts`.
- Run `execFile(claudePath, ["-p", message, "--cloud", sessionId, "--output-format", "json"], { timeout: 120_000, cwd: os.tmpdir() })`. Parse stdout as JSON; ok means `json.ok === true`. **Never use a shell.**
- Add a kill switch: env `SCIENCEDASH_BRIDGE_WAKE=0` disables actual wakes. The decision and state updates still run, and `detail` reports "wake disabled".

## 4. MCP tool: `register_rc_workhorse` (in `web/src/lib/mcp/tools/write.ts`)
- **Input:** `{ projectId, bridgeName, rcSessionId, rcEnvId, repo? }`
- **Behaviour:** upsert a `Workhorse` for `(host = bridgeName, sessionName = "rc-" + projectId.slice(0,10))` with `transport = "rc"`, the rc fields, `rcState = "live"`, `wakeCount = 0` and `recreateRequestedAt = null`. Mark any pending `recreate_rc_workhorse` directive for this project as read.
- This is how a person or a dispatcher session registers a workhorse it created in the rc environment.
- Follow the existing tool definition conventions (schema, `requireString` and so on).

## 5. Health
Extend `GET /api/health/hosts` to also return one entry per `Bridge`: `host = name`, status from `bridgeStatus` mapped `fresh → alive`, `stale → stale`, `down → down`, `activeHost = node`, `lastHeartbeat = lastBeat`, `workhorseCount = number of rc workhorses on it`. Optionally add `kind: "bridge"` and `envId`. `SyncHealthPill` should render bridges with no changes, or with minimal ones. Do not break the existing tmux host rows.

## 6. The keeper-side heartbeat script: `tools/bridge-keeper/`
- **`heartbeat.sh` (bash, POSIX tools only):** loops forever, every 60 s.
  - `node = hostname`.
  - `jobId = $SLURM_JOB_ID`.
  - `envId` from `~/.claude/projects/<key>/bridge-pointer.json`. Find the key from the keeper directory `$BRIDGE_DIR` (realpath, with `/` replaced by `-`); `jq` may be absent, so use `python3 -c`.
  - `rcAlive`: is the pid in `$BRIDGE_DIR/rc.pid` alive?
  - `liveSessions`: the `--session-id cse_…` arguments of `claude --print --sdk-url` processes owned by `$USER` on this node, taken from `ps -u $USER -o args`.
  - `claudeVersion` from `~/.local/bin/claude --version`.
  - POST the result as JSON with `curl -fsS --max-time 20 -H "Authorization: Bearer $SCIENCEDASH_AUTH_TOKEN" -H "User-Agent: sciencedash-bridge/1"` to `$SCIENCEDASH_URL/api/bridge/heartbeat`. Read `SCIENCEDASH_URL` and the token from `~/.sciencedash/auth.env` and `~/.sciencedash/config.json` (`dashboard_url`), the same way sync.py does. Errors go to stderr; the loop never exits on error.
- **`keeper.sh.example`:** shows the production keeper starting the heartbeat in the background (`heartbeat.sh &`, which dies with the job), writing `rc.pid` with `$$` before `exec claude rc --name perlmutter --permission-mode auto --debug-file … >/dev/null 2>&1`.
- **`README.md`:** install steps, and the scrontab line `#SCRON -q cron -A <acct> -t 24:00:00 --time-min=00:30:00 -J perlmutter-rc` with `*/5 * * * *`. Explain how to stop it: `scrontab -r` plus SIGTERM to rc; never plain `scancel`.

## 7. Tests and CI
- **No new dependencies.** Use Node's built-in runner: add the script `"test": "node --import tsx --test 'src/**/*.test.ts'"` (`tsx` is already a dependency) and write `web/src/lib/bridge/reconcile.test.ts` with `node:test` and `node:assert/strict`, covering every rule in 3a. Keep `reconcile.ts` free of `@/` path-alias imports so it runs under plain tsx. That's at least: fresh/stale/down thresholds, env changed → recreate (and its dedupe), live → mark_live, orphaned → wake, backoff respected, `wakeCount >= 8` → recreate, down 30 min → alert once, recovery → clear, inactive skipped, `sameSession("session_01X","cse_01X") === true`.
- Add a `npm test` step to `.github/workflows/ci.yml` after `tsc`.
- These must pass: `npx tsc --noEmit`, `npm test`, `npx prisma validate`, and `npx prisma migrate diff` (the migration matches the schema).

## Out of scope (phase 2)
- A dispatcher session that consumes `recreate_rc_workhorse` and creates sessions automatically.
- Showing when the Claude login expires.
- Retiring sync.py.
- Superfacility API recovery from outside.
- UI beyond the health pill.
