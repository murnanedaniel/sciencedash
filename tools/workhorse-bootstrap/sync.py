#!/usr/bin/env python3
"""ScienceDash workhorse sync daemon — cron-driven.

Run every minute via crontab. Each tick:
  - Acquire a lockfile (skip if a previous run is still active).
  - For each registered project on this host:
      * Read outbox.jsonl since last cursor; POST batch to dashboard /api/mcp/sync.
      * Receive directives; act on them locally (e.g. revive tmux session).
      * Append a sync-source heartbeat to the project's outbox so the dashboard
        knows the host is reachable.
  - Release lockfile, exit.

Designed to survive Perlmutter's silent process killer: cron itself is part
of the OS, and each tick is a fresh process. If a previous tick was killed
mid-flight, the next minute's tick takes over.

No external deps beyond stdlib + `requests` (or urllib if requests is absent).
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable
from urllib import request as urlreq
from urllib.error import HTTPError, URLError

# ----------------------------- config loading ----------------------------- #

DEFAULT_ROOT = Path.home() / ".sciencedash"


def load_config(root: Path) -> dict[str, Any]:
    """Read ~/.sciencedash/config.json. Falls back to YAML only if PyYAML present.

    Required fields: dashboard_url (str), host (str), projects (list of dicts
    with keys projectId, sessionName, repo).
    """
    json_path = root / "config.json"
    yaml_path = root / "config.yaml"
    if json_path.exists():
        with json_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    if yaml_path.exists():
        try:
            import yaml  # type: ignore
        except ImportError:
            sys.stderr.write(
                "config.yaml present but PyYAML not installed; rename to config.json\n"
            )
            sys.exit(2)
        with yaml_path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    sys.stderr.write(f"no config file found in {root}\n")
    sys.exit(2)


# ----------------------------- lockfile ---------------------------------- #


@contextmanager
def acquire_lock(lock_path: Path):
    """Single-instance lock via O_CREAT|O_EXCL. Stale locks (>5min) are taken."""
    LOCK_STALE_SECONDS = 5 * 60
    if lock_path.exists():
        age = time.time() - lock_path.stat().st_mtime
        if age < LOCK_STALE_SECONDS:
            sys.stderr.write(f"sync: lock held (age {age:.0f}s); exiting\n")
            sys.exit(0)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    except FileExistsError:
        sys.stderr.write("sync: lock raced; exiting\n")
        sys.exit(0)
    try:
        yield
    finally:
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


# ----------------------------- HTTP -------------------------------------- #


def _load_cf_access_headers(root: Path) -> dict[str, str]:
    """Read CF-Access service-token headers from `<root>/cf-access.env`.
    Format: shell-style KEY=VALUE lines (CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET). Returns {} if absent — dashboard then
    must be open / on a non-Access network for sync to work.
    """
    env_path = root / "cf-access.env"
    if not env_path.exists():
        return {}
    out: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    headers: dict[str, str] = {}
    cid = out.get("CF_ACCESS_CLIENT_ID")
    sec = out.get("CF_ACCESS_CLIENT_SECRET")
    if cid:
        headers["CF-Access-Client-Id"] = cid
    if sec:
        headers["CF-Access-Client-Secret"] = sec
    return headers


def post_json(
    url: str,
    body: dict[str, Any],
    extra_headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """POST a JSON body and return the JSON response. Raises on non-2xx."""
    data = json.dumps(body).encode("utf-8")
    # Cloudflare's Browser Integrity Check blocks the default
    # `Python-urllib/3.x` UA with HTTP 403 / error 1010, so set a real
    # name. Caller can override via extra_headers.
    headers = {
        "content-type": "application/json",
        "user-agent": "sciencedash-sync/1 (+https://github.com/murnanedaniel/ScienceDash)",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urlreq.Request(
        url,
        data=data,
        headers=headers,
        method="POST",
    )
    try:
        with urlreq.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode("utf-8")
    except HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HTTP {e.code} from {url}: {body_txt}") from e
    except URLError as e:
        raise RuntimeError(f"connection error to {url}: {e.reason}") from e
    if not payload.strip():
        return {}
    return json.loads(payload)


# ----------------------------- outbox/inbox ------------------------------ #


def append_jsonl(path: Path, items: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item) + "\n")


def read_outbox_batch(path: Path, max_items: int = 256) -> tuple[list[dict[str, Any]], int]:
    """Return up-to-N pending items + the count of bytes consumed.

    Reads atomically via a rename-based pattern: snapshot current outbox
    into a `.flushing` file, leave a fresh empty outbox.jsonl. If the
    flush fails downstream, the next tick picks up from the .flushing file.
    """
    flushing = path.with_suffix(".jsonl.flushing")
    if flushing.exists():
        # Previous tick crashed; replay it.
        items = _read_jsonl(flushing, max_items)
        return items, _file_size(flushing)
    if not path.exists() or path.stat().st_size == 0:
        return [], 0
    try:
        path.rename(flushing)
    except FileNotFoundError:
        return [], 0
    items = _read_jsonl(flushing, max_items)
    return items, _file_size(flushing)


def commit_outbox_flush(path: Path) -> None:
    """Once a batch was successfully POSTed, delete the .flushing file."""
    flushing = path.with_suffix(".jsonl.flushing")
    if flushing.exists():
        flushing.unlink()


def _read_jsonl(path: Path, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue
            if len(items) >= limit:
                break
    return items


def _file_size(p: Path) -> int:
    try:
        return p.stat().st_size
    except FileNotFoundError:
        return 0


# ----------------------------- directives -------------------------------- #


def execute_directive(
    directive: dict[str, Any],
    host: str,
    session_name: str,
    repo_path: str | None,
    project_id: str,
    root: Path,
) -> dict[str, Any]:
    """Act on a directive. Returns a result dict for logging."""
    name = directive.get("body") or ""
    payload: dict[str, Any] = {}
    if directive.get("payloadJson"):
        try:
            payload = json.loads(directive["payloadJson"])
        except (json.JSONDecodeError, TypeError):
            payload = {}
    if name == "revive_session":
        return _revive_session(
            session_name=session_name,
            cwd=repo_path or os.getcwd(),
            project_id=project_id,
            root=root,
        )
    if name == "workhorse_tick":
        return _workhorse_tick(
            session_name=session_name,
            payload=payload,
        )
    if name == "ping":
        return {"ok": True, "noted": "pong"}
    return {"ok": False, "error": f"unknown directive: {name!r}"}


_DEFAULT_TICK_PROMPT = (
    "Tick. Read this project's `nextSteps` via "
    "`mcp__sciencedash__get_project`. Pick exactly one concrete action and "
    "take it. If `nextSteps` is empty or stale, `create_check_in(kind=\"plan\")` "
    "proposing the next 3 steps. Be terse."
)


def _workhorse_tick(session_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Inject a one-shot prompt into a running workhorse Claude session.

    The prompt is sent via `tmux send-keys`. Claude's REPL queues the
    input at its next idle point — if a turn is in flight, the keys land
    in the input buffer and become the next user message. This is the
    standard interactive behaviour; no gate on "is claude at prompt"
    needed at the directive level (the dashboard side gates on activity
    recency before queueing).
    """
    if not shutil.which("tmux"):
        return {"ok": False, "error": "tmux not on PATH"}
    if _tmux_has_session(session_name) is not True:
        return {"ok": False, "error": f"tmux session {session_name!r} not alive"}
    prompt = payload.get("prompt") if isinstance(payload, dict) else None
    if not isinstance(prompt, str) or not prompt.strip():
        prompt = _DEFAULT_TICK_PROMPT
    # `-l` (literal) avoids tmux interpreting characters like `;` or `$`
    # in the prompt as send-keys metacharacters.
    #
    # tmux nuance: `send-keys -t =name` is rejected ("can't find pane")
    # even when the session exists, because send-keys expects a target-
    # pane spec and the `=` exact-match prefix is only honoured by
    # has-session/list-panes/etc. Use the bare session name here — the
    # _tmux_has_session() check above already proved it exists, so the
    # fuzzy-match pitfall (matching the wrong session) doesn't bite.
    try:
        subprocess.run(
            ["tmux", "send-keys", "-t", session_name, "-l", prompt],
            check=True,
            capture_output=True,
            timeout=5,
        )
        # Newline to submit. (Cannot combine with `-l` because `-l` would
        # send literal `\n` characters; the bare keyname `Enter` triggers
        # the submission keystroke.)
        subprocess.run(
            ["tmux", "send-keys", "-t", session_name, "Enter"],
            check=True,
            capture_output=True,
            timeout=5,
        )
    except subprocess.CalledProcessError as e:
        return {
            "ok": False,
            "error": f"send-keys failed: {e.stderr.decode('utf-8', 'replace')[:200]}",
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "send-keys timed out"}
    return {
        "ok": True,
        "session": session_name,
        "promptChars": len(prompt),
    }


def _revive_session(
    session_name: str,
    cwd: str,
    project_id: str,
    root: Path,
) -> dict[str, Any]:
    """Respawn a Claude tmux session for a project, fully wired:
    --mcp-config + --append-system-prompt CHAT_CONTEXT.md, falling back
    to a fresh session when --continue has no prior session.

    The previous version of this helper started Claude with no MCP
    config, so the revived session couldn't actually call ScienceDash
    tools — defeating the whole point of Revive. Now matches the
    dashboard's "Copy start" command shape.
    """
    if not shutil.which("tmux"):
        return {"ok": False, "error": "tmux not on PATH"}
    if not shutil.which("claude"):
        return {"ok": False, "error": "claude CLI not on PATH"}

    # Per-session protocol file under <projectId>/<sessionName>/.
    # CHAT_CONTEXT.md stays at <projectId>/ — it's project-shared truth.
    mcp_path = root / project_id / session_name / "mcp-config.json"
    ctx_path = root / project_id / "CHAT_CONTEXT.md"
    if not mcp_path.exists():
        return {
            "ok": False,
            "error": f"mcp-config not found at {mcp_path} — re-run setup.sh on this host",
        }

    # Inner shell command. Note: tmux runs this through the user's
    # default shell, so $(cat …) substitution happens at session start.
    inner = (
        f"cd {shlex.quote(cwd)} && ("
        f"claude --continue --mcp-config {shlex.quote(str(mcp_path))} "
        f'--append-system-prompt "$(cat {shlex.quote(str(ctx_path))} 2>/dev/null)" '
        f"2>/dev/null || "
        f"claude --mcp-config {shlex.quote(str(mcp_path))} "
        f'--append-system-prompt "$(cat {shlex.quote(str(ctx_path))} 2>/dev/null)"'
        f")"
    )

    # Kill any existing session with this name (ignore failure).
    subprocess.run(
        ["tmux", "kill-session", "-t", session_name],
        check=False,
        capture_output=True,
    )
    cmd = ["tmux", "new-session", "-d", "-s", session_name, inner]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=15)
    except subprocess.CalledProcessError as e:
        return {
            "ok": False,
            "error": f"tmux start failed: {e.stderr.decode('utf-8', 'replace')[:200]}",
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "tmux start timed out"}
    return {"ok": True, "session": session_name}


# ----------------------------- main loop --------------------------------- #


def _tmux_has_session(name: str) -> bool | None:
    """True if the tmux session exists, False if not, None if tmux unavailable.

    Uses an exact-equal match on session name (`-t =sd-foo`). Without the
    `=` sigil tmux does prefix-matching (so `sd-foo` would also match
    `sd-foobar`) — exact-equal is what we want.
    """
    if not shutil.which("tmux"):
        return None
    try:
        result = subprocess.run(
            ["tmux", "has-session", "-t", f"={name}"],
            check=False,
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return None


def _tmux_pane_pid(session_name: str) -> int | None:
    """PID of the pane's shell (root of the pane process tree)."""
    if not shutil.which("tmux"):
        return None
    try:
        r = subprocess.run(
            ["tmux", "list-panes", "-t", f"={session_name}", "-F", "#{pane_pid}"],
            check=False,
            capture_output=True,
            timeout=5,
        )
        if r.returncode != 0:
            return None
        first = r.stdout.decode("utf-8", "replace").strip().splitlines()
        if not first:
            return None
        return int(first[0])
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return None


def _claude_in_tree(root_pid: int) -> bool:
    """True if the `claude` process is anywhere under `root_pid`.

    Better signal than `pane_current_command` (which on some tmux
    versions stops at the immediate child shell, missing claude inside
    a subshell). Walks `ps -e` output to find descendants by ppid.
    """
    try:
        r = subprocess.run(
            ["ps", "-e", "-o", "pid=,ppid=,comm="],
            check=False,
            capture_output=True,
            timeout=5,
        )
        if r.returncode != 0:
            return False
    except (subprocess.TimeoutExpired, OSError):
        return False
    children: dict[int, list[tuple[int, str]]] = {}
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid, ppid = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        comm = parts[2].strip()
        children.setdefault(ppid, []).append((pid, comm))
    stack = [root_pid]
    seen: set[int] = set()
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        for child_pid, child_comm in children.get(pid, ()):
            if child_comm == "claude":
                return True
            stack.append(child_pid)
    return False


def sync_one_project(
    cfg: dict[str, Any],
    project_cfg: dict[str, Any],
    root: Path,
) -> None:
    project_id = project_cfg["projectId"]
    session_name = project_cfg.get("sessionName") or f"sd-{project_id}"
    repo_path: str | None = project_cfg.get("repo")
    tmux_alive = _tmux_has_session(session_name)
    # If tmux is alive and `claude` is somewhere in the pane's process
    # tree, consider Claude busy even when it hasn't called any
    # ScienceDash MCP tool. Lets us show 🟢 instead of 🟡 when the user
    # is having Claude do off-app work (codebase reading, training).
    claude_busy = False
    if tmux_alive:
        pane_pid = _tmux_pane_pid(session_name)
        if pane_pid is not None:
            claude_busy = _claude_in_tree(pane_pid)

    # Per-session protocol files (outbox/inbox/mcp-config) live under
    # <projectId>/<sessionName>/. CHAT_CONTEXT/MEMORY_LOG/HUMAN_DIRECTIVE
    # stay at <projectId>/ — they are project-level shared truth.
    project_dir = root / project_id
    session_dir = project_dir / session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    outbox_path = session_dir / "outbox.jsonl"
    log_path = root / "sync.log"

    # 1. Read pending outbox items.
    outbox_items, _bytes = read_outbox_batch(outbox_path)

    # 2. Always include a sync-daemon heartbeat in this batch.
    now_iso = _now_iso()
    outbox_items.append({"at": now_iso, "kind": "heartbeat", "source": "sync"})

    # 3. POST to dashboard.
    sync_url = cfg["dashboard_url"].rstrip("/") + "/api/mcp/sync"
    cf_headers = _load_cf_access_headers(root)
    try:
        resp = post_json(sync_url, {
            "host": cfg["host"],
            "projectId": project_id,
            "sessionName": session_name,
            # `repo` is the absolute path on this workhorse — the dashboard
            # stores it in Workhorse.configJson so the project page can
            # render a copy-paste tmux start command for this workhorse.
            "repo": repo_path,
            # Direct liveness signal: did the project's Claude tmux session
            # exist when this tick ran? Beats inferring liveness from
            # MCP-call timestamps (which can't tell "Claude idle at prompt"
            # from "Claude tmux is dead").
            "tmuxAlive": tmux_alive,
            # `claude` binary is alive in the pane's process tree even
            # though it hasn't called any ScienceDash MCP tool recently.
            # Together with tmuxAlive, lets the dashboard show 🟢 when
            # the user is having Claude do off-app work.
            "claudeBusy": claude_busy if tmux_alive else None,
            # The actual host running this sync.py (may differ from the
            # logical `host` field on round-robin clusters like NERSC,
            # where `host` is "perlmutter" but this is `login01`). The
            # spawned sd-<projectId> tmux session lives here, so the
            # dashboard surfaces this as the right ssh target for attach.
            "activeHost": socket.gethostname(),
            "outbox": outbox_items,
        }, extra_headers=cf_headers)
    except RuntimeError as e:
        _log(log_path, f"[{project_id}] sync POST failed: {e}")
        # Don't commit the flush — next tick will retry.
        return
    commit_outbox_flush(outbox_path)

    ack = resp.get("ack", 0)
    directives = resp.get("directives") or []
    _log(log_path, f"[{project_id}] ok ack={ack} directives={len(directives)}")

    # 4. Execute each directive locally.
    for d in directives:
        result = execute_directive(
            d,
            host=cfg["host"],
            session_name=session_name,
            repo_path=repo_path,
            project_id=project_id,
            root=root,
        )
        _log(log_path, f"[{project_id}] directive {d.get('body')!r} -> {result}")
        # Drop a status line back into the outbox so the dashboard sees the result.
        append_jsonl(outbox_path, [{
            "at": _now_iso(),
            "kind": "tool_call",
            "name": "post_message",
            "args": {
                "projectId": project_id,
                "body": f"directive `{d.get('body')}` executed: {result}",
                "kind": "status",
                "severity": "info",
                "source": f"workhorse-{cfg['host']}:{session_name}",
            },
        }])


def main() -> int:
    root = Path(os.environ.get("SCIENCEDASH_ROOT", str(DEFAULT_ROOT)))
    # Belt-and-braces: any unhandled exception in main is logged and turned
    # into a nonzero exit. The bash `while true; do sync.py; sleep …; done`
    # supervisor (see setup.sh) restarts us. Without this, a single bad
    # config or filesystem hiccup could blow up the Python process and the
    # restart loop would just churn silently.
    try:
        return _main_inner(root)
    except Exception as e:  # noqa: BLE001
        try:
            _log(root / "sync.log", f"main() uncaught: {type(e).__name__}: {e}")
        except Exception:  # noqa: BLE001
            pass
        return 3


def _main_inner(root: Path) -> int:
    cfg = load_config(root)
    if "dashboard_url" not in cfg or "host" not in cfg or "projects" not in cfg:
        sys.stderr.write("config missing required fields: dashboard_url, host, projects\n")
        return 2
    projects = cfg["projects"]
    if not isinstance(projects, list) or not projects:
        sys.stderr.write("config.projects must be a non-empty list\n")
        return 2

    lock_path = root / "sync.lock"
    with acquire_lock(lock_path):
        # Stamp this host as the active sync owner. setup.sh reads this on
        # other login nodes (NFS-shared `$HOME`) and refuses to start a
        # duplicate sd-sync loop — duplicates write to the same log but use
        # different per-host tmux servers, breaking liveness reporting.
        try:
            (root / "active-host.txt").write_text(socket.gethostname() + "\n")
        except OSError:
            pass
        for project_cfg in projects:
            try:
                sync_one_project(cfg, project_cfg, root)
            except Exception as e:  # noqa: BLE001
                _log(root / "sync.log", f"[{project_cfg.get('projectId', '?')}] uncaught: {e!r}")
    return 0


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"{_now_iso()} {line}\n")


if __name__ == "__main__":
    sys.exit(main())
