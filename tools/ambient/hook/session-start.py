#!/usr/bin/env python3
"""ScienceDash SessionStart hook — injects a project's slim context into every
Claude Code session, fetched fresh from the dashboard and cached locally so it
still works offline. BULLETPROOF BY DESIGN: any error, timeout, or missing
config results in an empty (no-op) injection and exit 0 — it must NEVER break or
slow a real session.

Reads the SessionStart JSON on stdin (cwd, source, ...), prints the
hookSpecificOutput JSON on stdout. Config auto-discovered from ~/.sciencedash/
(same as ship.py / the skill). Short network timeout; local cache fallback.
stdlib only.
"""
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

TIMEOUT = 4  # seconds — keep session startup snappy
SD = Path.home() / ".sciencedash"
CACHE_DIR = SD / "context"


def emit(context):
    """Always print a valid SessionStart output and exit 0."""
    try:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": context or "",
            }
        }))
    except Exception:
        print('{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":""}}')
    sys.exit(0)


def discover():
    url = os.environ.get("SCIENCEDASH_URL", "")
    if not url and (SD / "config.json").exists():
        try:
            url = json.loads((SD / "config.json").read_text()).get("dashboard_url", "")
        except Exception:
            pass
    url = (url or "http://localhost:3000").rstrip("/")
    token = os.environ.get("SCIENCEDASH_AUTH_TOKEN", "")
    if not token and (SD / "auth.env").exists():
        try:
            for line in (SD / "auth.env").read_text().splitlines():
                if line.strip().startswith("SCIENCEDASH_AUTH_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return url, token


def main():
    # Parse the SessionStart payload (cwd). Never raise.
    cwd = ""
    try:
        raw = sys.stdin.read()
        if raw:
            cwd = (json.loads(raw).get("cwd") or "").strip()
    except Exception:
        cwd = ""
    if not cwd:
        cwd = os.getcwd()

    cache_file = CACHE_DIR / (hashlib.sha1(cwd.encode()).hexdigest() + ".md")

    # Try fresh fetch; fall back to cache on any failure (offline-resilient).
    try:
        from urllib.parse import quote
        url, token = discover()
        req = urllib.request.Request(url + "/api/context/slim?cwd=" + quote(cwd))
        if token:
            req.add_header("authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            ctx = (json.loads(r.read().decode()) or {}).get("context", "") or ""
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(ctx)
        except Exception:
            pass
        emit(ctx)
    except Exception:
        # offline / dashboard down / error: use last-known cache
        try:
            if cache_file.exists():
                emit(cache_file.read_text())
        except Exception:
            pass
        emit("")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # absolute last resort — never break the session
        emit("")
