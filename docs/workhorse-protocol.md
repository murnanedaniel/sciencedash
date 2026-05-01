# Workhorse protocol

ScienceDash's "brains" live in the dashboard; the "workhorses" — actual
Claude Code sessions running on Perlmutter, Vast, etc. — live wherever the
GPUs are. They share state via the dashboard's project DB, not via direct
conversation.

This doc specifies the wire protocol between a workhorse and the dashboard.

## Topology

```
[ workhorse host (e.g. perlmutter) ]                  [ dashboard (laptop) ]
  ~/.sciencedash/
  ├── config.json                                       /api/mcp        ← MCP tools
  ├── sync.py     ──── cron every minute  ──── HTTP ──→ /api/mcp/sync   ← workhorse-only
  ├── sync.log
  └── <projectId>/
      ├── outbox.jsonl    appended by Claude tool calls + sync heartbeats
      ├── inbox.jsonl     directives consumed by sync.py (revive_session, ...)
      ├── PROJECT_BRIEF.md  (Phase F — brain memory tier 1)
      ├── MEMORY_LOG.md     (Phase F — brain memory tier 2)
      └── HUMAN_DIRECTIVE.md
```

Workhorse identity: `<host>:sd-<projectId>` (e.g. `perlmutter:sd-cmockitum0...`).

## sync.py loop (one tick per minute)

1. Acquire `~/.sciencedash/sync.lock` (skip if held; stale after 5 min).
2. For each `project_cfg` in `config.projects`:
   a. Read up to 256 pending lines from `<projectId>/outbox.jsonl`. The
      outbox is renamed to `outbox.jsonl.flushing` atomically; if the
      POST fails, the next tick replays the same `.flushing` file.
   b. Append a `{"kind":"heartbeat","source":"sync"}` item.
   c. POST `{host, projectId, sessionName, outbox}` to
      `/api/mcp/sync`.
   d. Receive `{ack, toolResults, directives}`. Commit the flush
      (delete `.flushing`).
   e. Execute each directive locally (e.g. `revive_session`). Append a
      `tool_call: post_message` outbox entry summarising the result.
3. Release lockfile, exit.

## /api/mcp/sync request

```json
{
  "host": "perlmutter",
  "projectId": "cmockitum0...",
  "sessionName": "sd-cmockitum0...",
  "outbox": [
    {"at": "2026-04-26T00:00:00Z", "kind": "heartbeat", "source": "sync"},
    {"at": "2026-04-26T00:00:05Z", "kind": "heartbeat", "source": "claude"},
    {"at": "2026-04-26T00:00:10Z",
     "kind": "tool_call", "name": "post_message",
     "args": {"projectId":"...", "body":"...", "severity":"info"}}
  ]
}
```

Outbox item `kind`s:

| kind         | source     | effect                                                                   |
|--------------|------------|--------------------------------------------------------------------------|
| `heartbeat`  | `sync`     | Update `Workhorse.lastHeartbeat`. Indicates `host_reachable`.            |
| `heartbeat`  | `claude`   | Update `Workhorse.lastClaudeBeat`. Indicates `claude_active`.            |
| `tool_call`  | (n/a)      | Execute the named MCP tool with `args`. Result echoed in `toolResults`.  |

Successful `tool_call` items also implicitly bump `lastClaudeBeat`.

## /api/mcp/sync response

```json
{
  "ack": 3,
  "toolResults": [
    {"name": "post_message", "ok": true, "result": {...}}
  ],
  "directives": [
    {"id": "...", "createdAt": "...", "body": "revive_session", "payloadJson": null}
  ]
}
```

The dashboard marks delivered directives as `readAt = now()` so they
don't re-fire. If the workhorse crashes mid-execution, the next sync
tick simply gets nothing (already marked read); use timestamps in
status messages to detect lost executions.

## Liveness derivation (dashboard side)

```
host_reachable     := lastHeartbeat  > now - 3 min
claude_active      := lastClaudeBeat > now - 10 min
```

UI states:

| state        | host_reachable | claude_active                                |
|--------------|----------------|----------------------------------------------|
| 🟢 alive     | yes            | yes                                          |
| 🟡 idle      | yes            | last beat 10–60 min ago                      |
| 🔴 dead      | yes            | last beat > 60 min ago, or never beat        |
| ⚫ unreachable | no             | (irrelevant)                                  |

## Directive vocabulary

| body              | payload         | sync.py effect                                                    |
|-------------------|-----------------|-------------------------------------------------------------------|
| `revive_session`  | (none)          | `tmux kill-session ...; tmux new -d -s <session> "claude --continue"` |
| `ping`            | (none)          | Replies with a `pong` post_message in outbox.                      |

Add new directives by extending `execute_directive` in `sync.py` and
documenting them here.

### Hosts without cron (NERSC Perlmutter, …)

`setup.sh` falls back to a tmux-driven sync loop on hosts where
`crontab` is missing. A detached session named `sd-sync` runs
`while true; do sync.py; sleep 60; done`. Same minute-granularity,
same outbox semantics. The trade-off: tmux sessions can be killed by
the host's reaper after long uptime, where cron itself never is. If
`sd-sync` dies, re-run `setup.sh` (idempotent — it kills any stale
session and respawns).

Inspect / re-attach:

```bash
tmux ls                    # should list sd-sync
tmux attach -t sd-sync     # see the loop running
```

## Doomsday recovery

If cron itself dies on the host (account suspended, machine rebuilt) — or
if the `sd-sync` tmux session got reaped on a cron-less host:

```bash
ssh <user>@<host>
DASHBOARD=https://your.dashboard HOST=<host> bash ~/.sciencedash-bootstrap/setup.sh
```

`setup.sh` is idempotent: it replaces the cron entry (or respawns the
tmux loop) without duplicating.
