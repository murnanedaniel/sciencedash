#!/usr/bin/env python3
"""ScienceDash transcript shipper — the ambient context layer's per-machine agent.

Tails ~/.claude/projects/**/*.jsonl (every Claude Code session on this machine,
terminal- or remote-controlled), extracts user/assistant/tool text, REDACTS
secrets locally, and ships incremental batches to ScienceDash's
/api/ingest/transcript. State (last line shipped per session) lives in
~/.sciencedash/transcripts/state.json, so the first run backfills everything and
later runs ship only new lines. Run once per minute via cron.

Config (reuses the workhorse conventions):
  ~/.sciencedash/auth.env     -> SCIENCEDASH_AUTH_TOKEN=...   (bearer)
  ~/.sciencedash/config.json  -> {"dashboard_url": "...", "host": "..."}  (optional)
Falls back to $SCIENCEDASH_URL or http://localhost:3000 and socket.gethostname().

stdlib only.
"""
import json
import os
import re
import socket
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

HOME = Path.home()
SD_DIR = HOME / ".sciencedash"
STATE_DIR = SD_DIR / "transcripts"
STATE_FILE = STATE_DIR / "state.json"
LOCK_FILE = STATE_DIR / "ship.lock"
PROJECTS_DIR = HOME / ".claude" / "projects"
BATCH = 256
LOCK_STALE_SEC = 300

# --- redaction (mirror web/src/lib/ingest/redact.ts; redact BEFORE shipping) ---
_PATTERNS = [
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bgh[ousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bwandb_v1_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]
_ENV_ASSIGN = re.compile(
    r"\b(SCIENCEDASH_AUTH_TOKEN|SCIENCEDASH_SESSION_SECRET|SCIENCEDASH_PASSWORD_SALT|"
    r"SCIENCEDASH_AUTH_PASSWORD_HASH|WANDB_API_KEY|GITHUB_PAT|GITHUB_TOKEN|ANTHROPIC_API_KEY|"
    r"AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY)\s*[:=]\s*[\"']?([A-Za-z0-9_\-./+=]{8,})[\"']?"
)


# Sessions we never ship: ScienceDash's own spawned agent runs (brain, /chat,
# quickstart) execute in ephemeral temp dirs — noise. Keep in sync with
# web/src/lib/ingest/noise.ts.
NOISE_CWD_PREFIXES = ("/tmp", "/var/tmp", "/private/tmp", "/private/var/folders")


def is_noise_cwd(cwd):
    if not cwd:
        return False
    c = cwd.strip()
    return any(c == p or c.startswith(p + "/") for p in NOISE_CWD_PREFIXES)


def git_remote(cwd):
    """Best-effort origin remote URL of cwd — the robust cross-machine project key."""
    try:
        import subprocess
        out = subprocess.run(
            ["git", "-C", cwd, "config", "--get", "remote.origin.url"],
            capture_output=True, text=True, timeout=3,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def redact(s):
    if not s:
        return s
    s = _ENV_ASSIGN.sub(lambda m: f"{m.group(1)}=«redacted»", s)
    for rx in _PATTERNS:
        s = rx.sub("«redacted»", s)
    return s


def load_config():
    token = os.environ.get("SCIENCEDASH_AUTH_TOKEN", "")
    authf = SD_DIR / "auth.env"
    if not token and authf.exists():
        for line in authf.read_text().splitlines():
            line = line.strip()
            if line.startswith("SCIENCEDASH_AUTH_TOKEN="):
                token = line.split("=", 1)[1].strip().strip('"').strip("'")
    url = os.environ.get("SCIENCEDASH_URL", "")
    host = ""
    cfg = SD_DIR / "config.json"
    if cfg.exists():
        try:
            d = json.loads(cfg.read_text())
            url = url or d.get("dashboard_url", "")
            host = d.get("host", "")
        except Exception:
            pass
    url = url or "http://localhost:3000"
    host = host or socket.gethostname()
    return url.rstrip("/"), token, host


def extract_event(obj):
    """Map one transcript JSONL line to {role,text,toolName,at} or None to skip."""
    typ = obj.get("type")
    ts = obj.get("timestamp")
    if typ == "user":
        msg = obj.get("message") or {}
        content = msg.get("content")
        text = _content_text(content)
        return {"role": "user", "text": text, "at": ts} if text else None
    if typ == "assistant":
        msg = obj.get("message") or {}
        content = msg.get("content") or []
        out = []
        tool_name = None
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            bt = block.get("type")
            if bt == "text" and block.get("text"):
                out.append(block["text"])
            elif bt == "tool_use":
                tool_name = block.get("name")
                keys = ",".join((block.get("input") or {}).keys()) if isinstance(block.get("input"), dict) else ""
                out.append(f"[tool: {block.get('name')}] {keys}")
        text = "\n".join(out).strip()
        return {"role": "assistant", "text": text, "toolName": tool_name, "at": ts} if text else None
    return None  # skip thinking-only, snapshots, queue-ops, mode, etc.


def _content_text(content):
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(p for p in parts if p).strip()
    return ""


def session_title(path):
    """Best-effort: last `ai-title` event in the file."""
    title = None
    try:
        with path.open() as f:
            for line in f:
                if '"ai-title"' in line:
                    try:
                        o = json.loads(line)
                        if o.get("type") == "ai-title" and o.get("aiTitle"):
                            title = o["aiTitle"]
                    except Exception:
                        pass
    except Exception:
        pass
    return title


def post(url, token, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url + "/api/ingest/transcript", data=data, method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("user-agent", "sciencedash-transcript/1")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def acquire_lock():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if LOCK_FILE.exists():
        try:
            age = time.time() - LOCK_FILE.stat().st_mtime
            if age < LOCK_STALE_SEC:
                return False
        except OSError:
            pass
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def main():
    url, token, host = load_config()
    if not acquire_lock():
        print("another shipper is running; exit", file=sys.stderr)
        return 0
    try:
        state = {}
        if STATE_FILE.exists():
            try:
                state = json.loads(STATE_FILE.read_text())
            except Exception:
                state = {}
        if not PROJECTS_DIR.exists():
            print("no ~/.claude/projects", file=sys.stderr)
            return 0

        shipped_sessions = 0
        shipped_events = 0
        for path in sorted(PROJECTS_DIR.glob("*/*.jsonl")):
            session_id = path.stem
            last = int(state.get(session_id, 0))
            try:
                lines = path.read_text(errors="replace").splitlines()
            except Exception as e:
                print(f"skip {path.name}: {e}", file=sys.stderr)
                continue
            total = len(lines)
            if last >= total:
                continue
            cwd = None
            title = session_title(path)
            # parse new lines into events
            events = []
            for raw in lines[last:total]:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except Exception:
                    continue
                if cwd is None and obj.get("cwd"):
                    cwd = obj["cwd"]
                ev = extract_event(obj)
                if ev:
                    ev["text"] = redact(ev.get("text", ""))
                    events.append(ev)
            if cwd is None:
                # fall back to decoding the dir name (-a-b-c -> /a/b/c)
                cwd = "/" + path.parent.name.lstrip("-").replace("-", "/")
            # Skip noise (ScienceDash's own /tmp agent runs); advance state so we
            # don't rescan the file every tick.
            if is_noise_cwd(cwd):
                state[session_id] = total
                STATE_FILE.write_text(json.dumps(state))
                continue
            # One request per session: the server dedups at the session level
            # (fromLine vs shippedLines), so a single append-or-skip is correct.
            # Skip POST for sessions with no extractable text, but still advance
            # state so we don't rescan them every tick.
            if events:
                try:
                    post(url, token, {
                        "machine": host, "sessionId": session_id, "cwd": cwd,
                        "gitRemote": git_remote(cwd),
                        "title": title, "events": events,
                        "fromLine": last, "totalLines": total,
                    })
                    shipped_events += len(events)
                except urllib.error.HTTPError as e:
                    print(f"HTTP {e.code} shipping {session_id}: {e.read()[:200]}", file=sys.stderr)
                    continue  # leave state un-advanced; retry next tick
                except Exception as e:
                    print(f"error shipping {session_id}: {e}", file=sys.stderr)
                    continue
            state[session_id] = total
            shipped_sessions += 1
            # persist state incrementally so a crash doesn't reship everything
            STATE_FILE.write_text(json.dumps(state))

        print(f"shipped {shipped_events} events across {shipped_sessions} sessions to {url}")
        return 0
    finally:
        try:
            LOCK_FILE.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
