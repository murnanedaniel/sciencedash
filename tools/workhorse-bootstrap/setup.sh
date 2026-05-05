#!/usr/bin/env bash
# ScienceDash workhorse bootstrap — one-shot installer.
#
# Run on each compute host (Perlmutter login, Vast box, etc.) once per host.
# Idempotent: re-running is safe and recreates the cron entry.
#
# Usage:
#   curl <DASHBOARD>/api/workhorse-bootstrap/setup.sh | DASHBOARD=https://... HOST=perlmutter bash
# or:
#   scp setup.sh sync.py user@host:~/.sciencedash-bootstrap/
#   DASHBOARD=https://... HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
set -euo pipefail

SCIENCEDASH_ROOT="${SCIENCEDASH_ROOT:-$HOME/.sciencedash}"

# Re-runs of setup.sh shouldn't require re-typing DASHBOARD/HOST when
# a config.json already exists. Fall back to its values; explicit env
# vars still win when set.
_CFG="$SCIENCEDASH_ROOT/config.json"
_read_cfg_field() {
  # _read_cfg_field <field> — echoes value or empty on any error.
  python3 -c 'import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1],"") or "")
except Exception: pass' "$1" < "$_CFG" 2>/dev/null || true
}
if [[ -f "$_CFG" ]] && command -v python3 >/dev/null 2>&1; then
  DASHBOARD="${DASHBOARD:-$(_read_cfg_field dashboard_url)}"
  HOST="${HOST:-$(_read_cfg_field host)}"
fi
DASHBOARD="${DASHBOARD:?set DASHBOARD=https://... or http://localhost:3000 (or put dashboard_url in $_CFG)}"
HOST="${HOST:-$(hostname -s)}"

echo "==> ScienceDash workhorse bootstrap"
echo "    root:      $SCIENCEDASH_ROOT"
echo "    dashboard: $DASHBOARD"
echo "    host:      $HOST"

mkdir -p "$SCIENCEDASH_ROOT"

# Pick where sync.py should live. If we were run from the bootstrap dir
# (e.g. via scp), copy sync.py next to config.json so cron runs a stable path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SRC="$SCRIPT_DIR/sync.py"
START_SYNC_SRC="$SCRIPT_DIR/start-sync.sh"
if [[ -f "$SYNC_SRC" ]]; then
  # If we were scp'd directly into $SCIENCEDASH_ROOT (in-place re-run),
  # skip the cp — it would fail with "same file". Either way, ensure
  # sync.py is executable.
  if [[ "$(realpath -- "$SYNC_SRC")" != "$(realpath -- "$SCIENCEDASH_ROOT/sync.py")" ]]; then
    cp -f "$SYNC_SRC" "$SCIENCEDASH_ROOT/sync.py"
    echo "==> installed sync.py at $SCIENCEDASH_ROOT/sync.py"
  else
    echo "==> sync.py already at $SCIENCEDASH_ROOT/sync.py (in-place run)"
  fi
  chmod +x "$SCIENCEDASH_ROOT/sync.py"
else
  echo "!! sync.py not found at $SYNC_SRC; copy it manually before continuing"
  exit 1
fi

# start-sync.sh is the idempotent "ensure sd-sync tmux is alive" helper.
# It's called from this script's tmux-fallback branch (below) and also
# prepended to the dashboard's "Copy start" command, so firing up a
# workhorse implicitly ensures sync is running.
if [[ -f "$START_SYNC_SRC" ]]; then
  if [[ "$(realpath -- "$START_SYNC_SRC")" != "$(realpath -- "$SCIENCEDASH_ROOT/start-sync.sh")" ]]; then
    cp -f "$START_SYNC_SRC" "$SCIENCEDASH_ROOT/start-sync.sh"
    echo "==> installed start-sync.sh at $SCIENCEDASH_ROOT/start-sync.sh"
  fi
  chmod +x "$SCIENCEDASH_ROOT/start-sync.sh"
fi

# Write a starter config if none exists. User edits to add projects.
if [[ ! -f "$SCIENCEDASH_ROOT/config.json" ]]; then
  cat > "$SCIENCEDASH_ROOT/config.json" <<JSON
{
  "dashboard_url": "$DASHBOARD",
  "host": "$HOST",
  "projects": []
}
JSON
  echo "==> wrote starter config.json — add projects via:"
  echo "    \$EDITOR $SCIENCEDASH_ROOT/config.json"
  echo "    each project entry: { \"projectId\": \"<id>\", \"sessionName\": \"sd-<id>\", \"repo\": \"<absolute-path-or-omit>\" }"
fi

# Install the periodic sync. Try crontab first; fall back to a tmux-driven
# loop if cron isn't available (e.g. NERSC Perlmutter login nodes).
SYNC_CMD_FRAGMENT="SCIENCEDASH_ROOT=$SCIENCEDASH_ROOT $SCIENCEDASH_ROOT/sync.py >> $SCIENCEDASH_ROOT/sync.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
  TMP_CRON="$(mktemp)"
  crontab -l 2>/dev/null | grep -v -F "$SCIENCEDASH_ROOT/sync.py" > "$TMP_CRON" || true
  echo "* * * * * $SYNC_CMD_FRAGMENT" >> "$TMP_CRON"
  crontab "$TMP_CRON"
  rm -f "$TMP_CRON"
  echo "==> crontab entry installed:"
  crontab -l | grep "$SCIENCEDASH_ROOT/sync.py"
elif command -v tmux >/dev/null 2>&1; then
  # No cron — delegate to start-sync.sh, which is the canonical idempotent
  # "ensure sd-sync tmux session is alive" helper. The dashboard's "Copy
  # start" button also calls this, so the same supervisor logic lives in
  # exactly one place.
  CURRENT_HOST="$(hostname -s)"
  tmux kill-session -t sd-sync 2>/dev/null || true
  if SCIENCEDASH_ROOT="$SCIENCEDASH_ROOT" FORCE="${FORCE:-0}" \
     bash "$SCIENCEDASH_ROOT/start-sync.sh"; then
    echo "==> cron not available — sync loop running in tmux session 'sd-sync' on $CURRENT_HOST"
    echo "    re-attach: tmux attach -t sd-sync"
    echo "    if the host kills it: re-run setup.sh (or click 'Copy start' on the dashboard)"
  else
    exit 1
  fi
else
  echo "!! Neither crontab nor tmux is available on this host — sync cannot run unattended."
  echo "!! Install one of them or run sync.py manually: $SCIENCEDASH_ROOT/sync.py"
  exit 1
fi

# Generate per-project mcp-config.json files for `claude --mcp-config <file>`.
# Each project's config sets X-Workhorse-Id so the dashboard can update
# lastClaudeBeat from any direct MCP tool call (heartbeat-by-tool-call).
if command -v python3 >/dev/null 2>&1; then
  # Quoted delimiter ('PY') so bash doesn't expand $vars or backticks
  # inside the Python script — the heredoc content includes markdown
  # code spans with backticks that bash would otherwise try to execute.
  python3 - <<'PY'
import json, os, sys
from pathlib import Path

root = Path(os.environ.get("SCIENCEDASH_ROOT", os.path.expanduser("~/.sciencedash")))
cfg_path = root / "config.json"
if not cfg_path.exists():
    sys.exit(0)
cfg = json.loads(cfg_path.read_text())
host = cfg.get("host", "unknown-host")
dashboard = cfg.get("dashboard_url", "http://localhost:3000").rstrip("/")

# Read SCIENCEDASH_AUTH_TOKEN from auth.env and bake it into each
# session's mcp-config.json so Claude's MCP tool calls authenticate
# at the dashboard's app-level proxy. Format: shell-style KEY=VALUE
# lines (same file sync.py reads).
#
# Replaces the old cf-access.env path. Cloudflare Access is no longer
# used; the dashboard self-authenticates via this Bearer token.
auth_headers = {}
auth_env = root / "auth.env"
if auth_env.exists():
    for line in auth_env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == "SCIENCEDASH_AUTH_TOKEN":
            token = v.strip().strip('"').strip("'")
            if token:
                auth_headers["Authorization"] = f"Bearer {token}"
            break

for p in cfg.get("projects", []):
    pid = p.get("projectId")
    if not pid:
        continue
    session = p.get("sessionName") or f"sd-{pid}"
    proj_dir = root / pid
    proj_dir.mkdir(parents=True, exist_ok=True)

    # Per-session protocol files under <projectId>/<sessionName>/.
    # Multiple sessions can coexist for the same project on the same
    # host (e.g. sd-cmockitu-data + sd-cmockitu-models).
    session_dir = proj_dir / session
    session_dir.mkdir(parents=True, exist_ok=True)

    # mcp-config.json — used with `claude --mcp-config <file>`. The
    # X-Workhorse-Id header makes each session's MCP calls identify
    # themselves, so claudeBeat updates the right Workhorse row.
    # Authorization: Bearer <token> authenticates at the dashboard's
    # app-level proxy.
    mcp_path = session_dir / "mcp-config.json"
    headers = {"X-Workhorse-Id": f"{host}:{session}"}
    headers.update(auth_headers)
    mcp_path.write_text(json.dumps({
        "mcpServers": {
            "sciencedash": {
                "type": "http",
                "url": f"{dashboard}/api/mcp",
                "headers": headers,
            }
        }
    }, indent=2) + "\n")
    # mcp-config.json contains the bearer token; tighten perms so other
    # users on this host can't read it.
    mcp_path.chmod(0o600)
    print(f"==> wrote {mcp_path}")

    # Warn (don't auto-delete) when legacy flat-layout files exist
    # alongside the new per-session subdir — they're harmless but
    # confusing if left lying around.
    for legacy_name in ("mcp-config.json", "outbox.jsonl", "inbox.jsonl"):
        legacy = proj_dir / legacy_name
        if legacy.exists():
            print(f"!! legacy file {legacy} predates per-session layout — safe to delete")

    # CHAT_CONTEXT.md — pass via `--append-system-prompt "$(cat …)"` so
    # Claude knows to use mcp__sciencedash__* tools instead of inferring
    # "this project" from the cwd's git history.
    ctx_path = proj_dir / "CHAT_CONTEXT.md"
    ctx_path.write_text(f"""# ScienceDash chat-with-project context

You are in a ScienceDash project workspace on a remote workhorse host.
The user's research project has live state in the ScienceDash dashboard
DB — runs, hypotheses, decisions, literature notes, agent messages.

## Default behaviour

When the user asks about **the project's state, hypotheses, runs,
decisions, recent literature, brain output, or workhorses**, use the
`mcp__sciencedash__*` tools — these read the live DB. Do NOT infer
project state from git history, file contents, or directory structure
unless explicitly asked about the codebase.

When asked about **the codebase or to edit files**, use Bash / Read /
Write / Edit / Glob / Grep as you normally would.

## This project's id

`{pid}`

Examples:
- `mcp__sciencedash__get_project(id="{pid}")`
- `mcp__sciencedash__list_runs(projectId="{pid}")`
- `mcp__sciencedash__list_hypotheses(projectId="{pid}")`
- `mcp__sciencedash__list_notes(projectId="{pid}", kind="paper")`
- `mcp__sciencedash__list_decisions(projectId="{pid}")`
- `mcp__sciencedash__post_message(projectId="{pid}", body=…, severity=…)`
- `mcp__sciencedash__create_check_in(projectId="{pid}", body=…)`
- `mcp__sciencedash__record_decision(projectId="{pid}", kind=…, subjectType=…, subjectId=…, rationale=…)`

## Tool selection cheat sheet (write tools)

Pick the tool that matches the *shape* of what you're recording, not just the medium:

| Situation | Tool |
| --- | --- |
| Adopting a multi-step plan (timeline, scope, budget) | `create_check_in` with `kind="plan"`. Pair with `proposedPatches` for project-field updates that need human review (timeline / blockers / nextSteps / figuresOfMerit). |
| Routine progress / observation | `create_check_in` with `kind="routine"`. |
| Blocker just appeared | `create_check_in` with `kind="blocker"`. |
| Post-mortem after a run / sprint | `create_check_in` with `kind="retro"`. |
| Recording a deliberate decision (promote/park/narrow/budget_escalate/...) | `record_decision`. Always set `evidenceIds: [{{type, id}}, ...]` pointing at the check-in / note / run that grounds it — strong-typed pointers, not prose references. |
| Direct project-field write (you're authoritative, no human review needed) | `update_project_fields(projectId="{pid}", timeline=…, blockers=…, …)`. |
| One-line broadcast for `/today` digest | `post_message` with `severity` ∈ info/suggestion/decision/blocker. |
| Adding an arXiv paper / book / talk | `add_note` (this is the *reading list* — never use it for plans or in-project documents). |

**Common multi-step pattern for plan adoption:**
1. `create_check_in(kind="plan", body=<markdown>, proposedPatches=[…])` → returns `id`.
2. `record_decision(kind="budget_escalate"|"narrow"|…, subjectType="project", subjectId="{pid}", rationale=…, evidenceIds=[{{type:"checkIn", id:<from step 1>}}])`.
3. `post_message(severity="decision", body=<one-liner>)` for `/today`.

## Tick prompts (autonomous nudges)

Periodically — either when the user clicks **Tick** in the dashboard's
Workhorses panel, or on a 30-min schedule when the project's autonomy
config has `workhorse_tick: auto` — sync.py will inject a one-shot
prompt into this REPL via `tmux send-keys`. The prompt typically reads:

> Tick. Read this project's `nextSteps` via `mcp__sciencedash__get_project`.
> Pick exactly one concrete action and take it. If `nextSteps` is empty
> or stale, `create_check_in(kind="plan")` proposing the next 3 steps. Be terse.

When you receive a tick prompt:
1. Treat it as a normal user turn — no special handling needed.
2. Use the cheat sheet above to pick the right write tool for the
   action you take.
3. Keep it to one concrete step. Don't try to do five things at once.
4. If the project's state already shows that the obvious next step is
   running (e.g. a workhorse-launched run is mid-flight), just `post_message`
   with `severity="info"` summarising the wait — don't restart things.

## Voice contract

Be terse and decision-shaped — match the dashboard's tone.
""")
    print(f"==> wrote {ctx_path}")
PY
fi

# Quick connectivity probe.
if command -v curl >/dev/null 2>&1; then
  echo "==> probing dashboard"
  if curl -fsS "$DASHBOARD/api/mcp" -o /dev/null; then
    echo "    reachable ✓"
  else
    echo "    NOT REACHABLE — sync will retry every minute, no harm done"
  fi
fi

echo
echo "Done. Edit $SCIENCEDASH_ROOT/config.json to register your projects."
echo "Logs: $SCIENCEDASH_ROOT/sync.log"
echo "First sync runs within 60 seconds."
