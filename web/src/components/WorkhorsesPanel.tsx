/**
 * Workhorses panel — server component rendered on the project page.
 *
 * Shows each registered workhorse for the project with its derived
 * liveness state (🟢 alive / 🟡 idle / 🔴 dead / ⚫ unreachable) and a
 * Revive button when state is dead. Liveness derivation is duplicated
 * with `list_workhorses` MCP tool — keep them in sync.
 */

import { prisma } from "@/lib/prisma";
import {
  reviveWorkhorseAction,
  tickWorkhorseAction,
} from "@/lib/server/agentMessageActions";
import { CopyButton } from "@/components/CopyButton";
import { AddWorkhorseForm } from "@/components/AddWorkhorseForm";
import { RemoveWorkhorseButton } from "@/components/RemoveWorkhorseButton";
import { resolveDashboardOrigin } from "@/lib/brain/dashboard-origin";

const HOST_STALE_MS = 3 * 60_000;
const CLAUDE_IDLE_MS = 30 * 60_000;

type State = "alive" | "idle" | "dead" | "unreachable";

/**
 * Derive workhorse state.
 *
 * Primary signal is the workhorse's tmux session existence (sent by
 * sync.py via tmuxAlive in configJson). When that's available, "tmux
 * dead" → 🔴 immediately, regardless of how recently Claude made an
 * MCP call. (A bare-prompt Claude makes no MCP calls, so MCP-beat
 * staleness is a poor liveness proxy.)
 *
 * Fallback for older sync.py versions or hosts without tmux: pure
 * time-based thresholds on the MCP claude beat.
 */
function deriveState(
  now: number,
  lastHeartbeat: Date | null,
  lastClaudeBeat: Date | null,
  tmuxAlive: boolean | null,
  claudeBusy: boolean | null,
): State {
  const hb = lastHeartbeat?.getTime() ?? 0;
  const cb = lastClaudeBeat?.getTime() ?? 0;
  const hostAlive = hb && now - hb < HOST_STALE_MS;
  if (!hostAlive) return "unreachable";

  // Direct signal — when the workhorse told us its tmux state.
  if (tmuxAlive === false) return "dead";
  if (tmuxAlive === true) {
    // Process-level signal: claude is in the pane process tree right
    // now (off-app work — Read/Glob/Edit, training scripts). Treat as
    // alive even if no MCP call has happened recently.
    if (claudeBusy === true) return "alive";
    // tmux exists; if Claude has been silent a long time, mark idle.
    if (cb > 0 && now - cb > CLAUDE_IDLE_MS) return "idle";
    return "alive";
  }

  // Fallback (no tmux signal): can't tell idle from dead, so be
  // conservative — if we've never seen a Claude beat, call it dead;
  // if it's recent, alive; if stale, idle.
  if (!cb) return "dead";
  const claudeAge = now - cb;
  if (claudeAge < 5 * 60_000) return "alive";
  if (claudeAge < CLAUDE_IDLE_MS) return "idle";
  return "dead";
}

const STATE_BADGE: Record<State, { dot: string; label: string; color: string }> = {
  alive: { dot: "🟢", label: "alive", color: "var(--accent, #2a8c4a)" },
  idle: { dot: "🟡", label: "idle", color: "var(--accent2, #b08a3a)" },
  dead: { dot: "🔴", label: "dead", color: "var(--red, #c0322a)" },
  unreachable: { dot: "⚫", label: "unreachable", color: "var(--muted, #888)" },
};

function relTime(d: Date | null): string {
  if (!d) return "never";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export async function WorkhorsesPanel({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const [workhorses, dashboardOrigin] = await Promise.all([
    prisma.workhorse.findMany({
      where: { projectId },
      orderBy: { host: "asc" },
    }),
    resolveDashboardOrigin(),
  ]);
  const token = process.env.SCIENCEDASH_AUTH_TOKEN ?? "";

  const now = Date.now();
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="sectionTitle" style={{ margin: 0 }}>
          Workhorses
        </h2>
        <span className="muted small">
          {workhorses.length === 0
            ? "no workhorses yet"
            : `${workhorses.length} registered`}
        </span>
      </div>
      {workhorses.length === 0 ? (
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          A workhorse is a Claude REPL running in a tmux session on a compute
          host (Perlmutter login, Vast box, etc.) that ScienceDash can talk to
          via MCP. Once one is registered, you can Restart and Tick it from
          here. Use the form below to spin one up.
        </p>
      ) : null}
      <div className="stack" style={{ marginTop: 10, gap: 8 }}>
        {workhorses.map((w) => {
          const config = parseConfigJson(w.configJson);
          const state = deriveState(
            now,
            w.lastHeartbeat,
            w.lastClaudeBeat,
            config.tmuxAlive,
            config.claudeBusy,
          );
          const badge = STATE_BADGE[state];
          const repo = config.repo;
          const startCmd = repo
            ? buildStartCommand({
                sessionName: w.sessionName,
                repo,
                projectId,
              })
            : null;
          const attachCmd = `tmux attach -t ${w.sessionName}`;
          return (
            <div
              key={w.id}
              style={{
                padding: "8px 10px",
                border: "1px solid var(--border, #e0e0e0)",
                borderRadius: 6,
              }}
            >
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <span title={`state: ${badge.label}`} style={{ fontSize: 14 }}>
                  {badge.dot}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}>
                    {w.host}:{w.sessionName}
                  </div>
                  <div className="muted small">
                    host: {relTime(w.lastHeartbeat)} · claude:{" "}
                    {config.claudeBusy === true
                      ? "working"
                      : relTime(w.lastClaudeBeat)}
                    {config.tmuxAlive === true
                      ? " · tmux: alive"
                      : config.tmuxAlive === false
                        ? " · tmux: dead"
                        : ""}
                    {config.activeHost && config.activeHost !== w.host
                      ? ` · on: ${config.activeHost}`
                      : ""}
                    {repo ? ` · repo: ${repo}` : ""}
                  </div>
                </div>
                <span
                  className="pill"
                  style={{ background: badge.color, color: "#fff", fontSize: 11 }}
                >
                  {badge.label}
                </span>
              </div>
              <div
                className="row"
                style={{ gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}
              >
                {startCmd ? (
                  <CopyButton
                    value={startCmd}
                    label="Copy start"
                    title={`Copy: tmux + claude start command for ${w.host}:${w.sessionName}`}
                  />
                ) : (
                  <span className="muted small">
                    repo path not yet known (waiting for first sync)
                  </span>
                )}
                <CopyButton
                  value={attachCmd}
                  label="Copy attach"
                  title={`Copy: ${attachCmd}`}
                />
                {/* Always available — the same revive_session directive
                    works as a "restart" when the session is alive but
                    its loaded mcp-config is stale (URL change, secret
                    rotation, etc.). Label is the only thing that
                    changes by state. */}
                <form action={reviveWorkhorseAction}>
                  <input type="hidden" name="workhorseId" value={w.id} />
                  <button
                    type="submit"
                    className="button buttonSecondary small"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    title={
                      state === "unreachable"
                        ? "Host hasn't checked in. Revive will queue but won't fire until sync is back."
                        : state === "dead"
                          ? "Queue revive_session — sync.py will tmux-respawn within ~1 min."
                          : "Queue revive_session — kills + respawns the tmux pane so it picks up the latest mcp-config (URL / auth / context). ~1 min round-trip."
                    }
                  >
                    {state === "dead" || state === "unreachable" ? "Revive" : "Restart"}
                  </button>
                </form>
                {/* Tick: queue workhorse_tick directive — sync.py
                    tmux-send-keys's a "take one concrete next step"
                    prompt into the Claude REPL. Disabled when session
                    isn't alive (nothing to send keys to). */}
                <form action={tickWorkhorseAction}>
                  <input type="hidden" name="workhorseId" value={w.id} />
                  <button
                    type="submit"
                    className="button buttonSecondary small"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    disabled={state === "dead" || state === "unreachable"}
                    title={
                      state === "dead" || state === "unreachable"
                        ? "Workhorse session isn't alive — Revive first, then Tick."
                        : "Queue workhorse_tick — sync.py injects a 'take one concrete next step' prompt into the Claude REPL within ~60s."
                    }
                  >
                    Tick
                  </button>
                </form>
                {/* Remove: queue stop_session directive (kills tmux +
                    drops project from local config.json) and unregister
                    the row. Always available — graceful for live
                    workhorses, cleanup for unreachable ones. */}
                <RemoveWorkhorseButton
                  workhorseId={w.id}
                  host={w.host}
                  sessionName={w.sessionName}
                />
              </div>
            </div>
          );
        })}
      </div>
      <AddWorkhorseForm
        projectId={projectId}
        projectTitle={projectTitle}
        dashboardOrigin={dashboardOrigin}
        token={token}
      />
    </div>
  );
}

type WorkhorseConfig = {
  repo: string | null;
  tmuxAlive: boolean | null;
  tmuxCheckedAt: Date | null;
  claudeBusy: boolean | null;
  activeHost: string | null;
};

function parseConfigJson(configJson: string | null): WorkhorseConfig {
  if (!configJson)
    return {
      repo: null,
      tmuxAlive: null,
      tmuxCheckedAt: null,
      claudeBusy: null,
      activeHost: null,
    };
  try {
    const parsed = JSON.parse(configJson) as {
      repo?: unknown;
      tmuxAlive?: unknown;
      tmuxCheckedAt?: unknown;
      claudeBusy?: unknown;
      activeHost?: unknown;
    };
    return {
      repo: typeof parsed.repo === "string" ? parsed.repo : null,
      tmuxAlive:
        parsed.tmuxAlive === true ? true : parsed.tmuxAlive === false ? false : null,
      tmuxCheckedAt:
        typeof parsed.tmuxCheckedAt === "string"
          ? new Date(parsed.tmuxCheckedAt)
          : null,
      claudeBusy:
        parsed.claudeBusy === true ? true : parsed.claudeBusy === false ? false : null,
      activeHost: typeof parsed.activeHost === "string" ? parsed.activeHost : null,
    };
  } catch {
    return {
      repo: null,
      tmuxAlive: null,
      tmuxCheckedAt: null,
      claudeBusy: null,
      activeHost: null,
    };
  }
}

function buildStartCommand({
  sessionName,
  repo,
  projectId,
}: {
  sessionName: string;
  repo: string;
  projectId: string;
}): string {
  // Single-quote the cwd to handle paths with spaces. The inner shell
  // uses double-quotes around the --append-system-prompt arg so the
  // $(cat …) substitution runs.
  const cwd = JSON.stringify(repo); // produces a double-quoted string
  // CHAT_CONTEXT is project-shared across sessions on the same workhorse.
  // Tools reach ScienceDash through the installed `sciencedash` skill,
  // which auto-discovers its URL/token from ~/.sciencedash/{config.json,
  // auth.env} on this host — no per-session mcp-config.json needed.
  const ctx = `~/.sciencedash/${projectId}/CHAT_CONTEXT.md`;
  // The whole thing must be quoted as the tmux child command. Use a
  // single-quoted outer + escape inner singles via '\''.
  const inner =
    `cd ${cwd} && (` +
    `claude --continue --append-system-prompt "$(cat ${ctx} 2>/dev/null)" 2>/dev/null || ` +
    `claude --append-system-prompt "$(cat ${ctx} 2>/dev/null)"` +
    `)`;
  // Couple sync lifetime to workhorse lifetime: ensure sd-sync is alive
  // before attaching the workhorse session. start-sync.sh is idempotent
  // (no-op if already running) and refuses on duplicate-host. If sync
  // can't start (no tmux, missing sync.py, etc.) we still try to attach
  // the workhorse — partial functionality beats none.
  const ensureSync = `bash ~/.sciencedash/start-sync.sh || echo "(sync supervisor not started — fix and re-run)"`;
  return `${ensureSync} && tmux new -As ${sessionName} '${inner.replace(/'/g, `'\\''`)}'`;
}
