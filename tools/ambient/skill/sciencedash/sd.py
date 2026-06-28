#!/usr/bin/env python3
"""sciencedash skill CLI — the zero-config bridge from any Claude Code session to
ScienceDash. Talks to the authenticated HTTP API (bearer), so no per-session MCP
wiring is needed. Used by the `sciencedash` skill (see SKILL.md).

Config (auto-discovered):
  url    : $SCIENCEDASH_URL  ->  ~/.sciencedash/config.json:dashboard_url  ->  http://localhost:3000
  token  : $SCIENCEDASH_AUTH_TOKEN  ->  ~/.sciencedash/auth.env:SCIENCEDASH_AUTH_TOKEN

Commands:
  sd.py search "<query>"            search your conversation history (all machines)
  sd.py projects                    list active projects
  sd.py context <projectId>         a project's brief (status, hypothesis, next steps, metrics)
  sd.py log-decision <projectId> "<rationale>"   record a decision on a project
stdlib only.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

SD = Path.home() / ".sciencedash"


def config():
    url = os.environ.get("SCIENCEDASH_URL", "")
    if not url and (SD / "config.json").exists():
        try:
            url = json.loads((SD / "config.json").read_text()).get("dashboard_url", "")
        except Exception:
            pass
    url = (url or "http://localhost:3000").rstrip("/")
    token = os.environ.get("SCIENCEDASH_AUTH_TOKEN", "")
    if not token and (SD / "auth.env").exists():
        for line in (SD / "auth.env").read_text().splitlines():
            if line.strip().startswith("SCIENCEDASH_AUTH_TOKEN="):
                token = line.split("=", 1)[1].strip().strip('"').strip("'")
    return url, token


def call(method, path, body=None):
    url, token = config()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "detail": e.read().decode()[:300]}
    except Exception as e:
        return {"error": str(e)}


def mcp(name, args):
    """Call an MCP tool over the JSON-RPC endpoint."""
    res = call("POST", "/api/mcp", {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": name, "arguments": args},
    })
    return res


def cmd_search(query):
    from urllib.parse import quote
    d = call("GET", f"/api/search/threads?q={quote(query)}")
    if d.get("error"):
        print(f"error: {d['error']} {d.get('detail','')}")
        return 1
    results = d.get("results", [])
    print(f"{len(results)} conversation(s) matching {query!r}:\n")
    for r in results:
        when = (r.get("lastAt") or "")[:10]
        proj = f" · {r['projectTitle']}" if r.get("projectTitle") else ""
        print(f"• {r.get('title') or '(untitled)'}  [{r.get('machine')} {when}{proj}]")
        snip = (r.get("snippet") or "").replace("⟦", "").replace("⟧", "").replace("\n", " ")
        if snip:
            print(f"    …{snip[:160]}")
        print(f"    open: {config()[0]}/threads/{r.get('sessionId')}")
    return 0


def cmd_projects():
    res = mcp("query_entity", {"kind": "project", "limit": 100})
    _print_mcp(res)
    return 0


def cmd_context(project_id):
    res = mcp("get_entity", {"kind": "project", "id": project_id})
    _print_mcp(res)
    return 0


def cmd_log_decision(project_id, rationale):
    res = mcp("record_decision", {
        "projectId": project_id, "kind": "other",
        "subjectType": "project", "subjectId": project_id,
        "rationale": rationale,
    })
    _print_mcp(res)
    return 0


def _print_mcp(res):
    if res.get("error"):
        print(f"error: {res['error']} {res.get('detail','')}")
        return
    content = (res.get("result") or {}).get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                print(block.get("text", ""))
    else:
        print(json.dumps(res, indent=2))


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 0
    cmd = argv[1]
    if cmd == "search" and len(argv) >= 3:
        return cmd_search(" ".join(argv[2:]))
    if cmd == "projects":
        return cmd_projects()
    if cmd == "context" and len(argv) >= 3:
        return cmd_context(argv[2])
    if cmd == "log-decision" and len(argv) >= 4:
        return cmd_log_decision(argv[2], " ".join(argv[3:]))
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
