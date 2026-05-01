# Cluster Claude integration

Hooks up a long-running Claude Code session on a remote compute host
(Perlmutter, Vast, your home server, …) so its activity shows up in the
ScienceDash dashboard and so the dashboard can revive its tmux session
when it gets killed.

The wire protocol is in [workhorse-protocol.md](./workhorse-protocol.md);
this is the day-to-day setup guide.

## What you get after setup

- A 🟢 / 🟡 / 🔴 / ⚫ liveness indicator per project in the Workhorses
  panel on the project page. State derived from two heartbeats: a
  cron-driven sync ping (host_reachable) and Claude's tool calls
  (claude_active).
- A **Revive** button that respawns the tmux Claude when it dies
  (Perlmutter's reaper, OOM, container reboot, …). Round-trip ~2 min.
- Cluster Claude can call any MCP tool the dashboard exposes —
  `list_projects`, `record_decision`, `post_message`, etc. — so its
  observations and decisions land in the same project DB the dashboard
  reads from.
- Cluster Claude posts feed messages with `source = workhorse-<host>:sd-<id>`
  visible on /today and the per-project Feed tab.

## Prerequisites

On the cluster host:
- `python3` (stdlib only — no pip installs)
- `cron` *or* `tmux` — `setup.sh` uses cron when available and falls
  back to a tmux-driven sync loop on hosts without cron (e.g. NERSC
  Perlmutter login nodes)
- `tmux` (also required for reviving Claude sessions and for the
  cron-fallback sync loop)
- `claude` (Claude Code CLI) on PATH
- Outbound HTTPS reachability to the dashboard

On the laptop (or wherever ScienceDash runs):
- The dashboard reachable from the cluster via a public HTTPS URL.
  Easiest path: a `cloudflared` quick-tunnel (see below). Cloud or
  home-box deployments work too. SSH reverse tunnel is a no-third-party
  alternative with login-node pinning gotchas.

## Topology — making the dashboard reachable

### Recommended: cloudflared quick-tunnel

One command on the laptop, free public HTTPS URL, no SSH gymnastics.

**Install once** (Linux / WSL2):

```bash
curl -L --output /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
```

macOS: `brew install cloudflared`.

**Each work session:**

```bash
cloudflared tunnel --url http://localhost:3000
# prints: https://random-three-words.trycloudflare.com
```

Keep that terminal alive. The cluster's `dashboard_url` is now that
public URL — no SSH tunnel needed, no login-node pinning concerns.
Reconnects, round-robin, ControlMaster — all irrelevant.

**Quick-tunnel caveat**: each invocation gets a *new* random URL.
Restarting it (laptop sleep / terminal close) means re-running setup.sh
on the cluster with the new `DASHBOARD=`.

For a stable URL, register a free Cloudflare account, point a domain
at it, and use `cloudflared tunnel create` for a *named* tunnel —
this is the v2 deployment path when the dashboard moves to a home box.

### Alternative: SSH reverse tunnel

```bash
# On the laptop, in any persistent shell or tmux:
ssh -R 3000:localhost:3000 -N your-perlmutter-login
```

Tradeoffs: NERSC's `perlmutter.nersc.gov` round-robins across login
nodes; the tunnel binds on whichever node SSH lands on. If your work
session lands on a different node, sync fails. Use SSH ControlMaster
to pin both onto the same connection — see
[setup-tutorial.md → SSH-tunnel alternative](./setup-tutorial.md#alternative-ssh-reverse-tunnel-with-controlmaster).

When the laptop sleeps or moves, the tunnel dies. The cron sync daemon
doesn't care — it queues outbox messages locally and flushes when
reachable. Direct MCP tool calls from cluster Claude fail during
outage; Claude retries.

## One-shot setup on the cluster host

From your laptop:

```bash
scp tools/workhorse-bootstrap/sync.py     user@host:~/.sciencedash-bootstrap/sync.py
scp tools/workhorse-bootstrap/setup.sh    user@host:~/.sciencedash-bootstrap/setup.sh
ssh user@host
DASHBOARD=https://your-cloudflared-url HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

(Or `DASHBOARD=http://localhost:3000` if you went the SSH-tunnel route.)

This installs:
- `~/.sciencedash/sync.py` (the cron-driven sync daemon)
- `~/.sciencedash/config.json` (starter; you edit it next)
- A crontab entry: `* * * * * SCIENCEDASH_ROOT=… …/sync.py …`

## Register a project on this host

Edit `~/.sciencedash/config.json` to add an entry per project active on
this host:

```json
{
  "dashboard_url": "https://your-cloudflared-three-words.trycloudflare.com",
  "host": "perlmutter",
  "projects": [
    {
      "projectId": "<paste from project URL>",
      "sessionName": "sd-<short-projectId>",
      "repo": "/global/homes/.../tracking-review"
    }
  ]
}
```

(Use `http://localhost:3000` if you went the SSH-tunnel route.)

Re-run `setup.sh` (idempotent) so it generates the per-project
`~/.sciencedash/<projectId>/mcp-config.json` for use with Claude:

```bash
DASHBOARD=https://your-cloudflared-three-words.trycloudflare.com HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

## Start a Claude Code session that's wired in

```bash
tmux new -As sd-<projectId> "cd <repo> && claude --mcp-config ~/.sciencedash/<projectId>/mcp-config.json"
```

That session can now:
- Call `mcp__sciencedash__list_runs(projectId)` to see W&B-synced runs
- Call `mcp__sciencedash__post_message(projectId, ...)` to drop notes
  into your dashboard's feed
- Call `mcp__sciencedash__record_decision(...)` to record a deliberate
  decision against a hypothesis

Each tool call that hits `/api/mcp` includes the `X-Workhorse-Id`
header (set in mcp-config.json), which updates `lastClaudeBeat` on the
Workhorse row. So **no special heartbeat hook is needed** — the act of
using the MCP IS the heartbeat.

## Verifying it works

Within ~1 minute of `setup.sh`, on the dashboard's project page you
should see a Workhorses panel entry for `<host>:sd-<id>` showing 🟡
idle (host fresh, claude not yet seen). Once you start a Claude
session and it makes any MCP tool call, the indicator flips to 🟢
alive.

To force a sanity check from the dashboard:

```bash
# In the dashboard's MCP, queue a ping directive:
curl -s -X POST http://localhost:3000/api/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"queue_directive","arguments":{"projectId":"<id>","host":"perlmutter","sessionName":"sd-<id>","name":"ping"}}}'
```

Within ~1 minute the workhorse's next sync tick consumes the ping and
posts a `pong` message to the project's feed.

## Doomsday recovery

If cron itself stops (account suspension, machine rebuilt, accidental
`crontab -r`):

```bash
ssh user@host
DASHBOARD=<your dashboard URL> HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

`setup.sh` is idempotent. It re-installs the cron entry (or respawns
the tmux sync loop on cron-less hosts), regenerates mcp-config.json
files from your existing `config.json`, and brings the
Workhorses panel back from ⚫ unreachable.

## Common issues

**"sync POST failed: connection error"** — dashboard isn't reachable
from the cluster. Check the SSH tunnel or your dashboard URL.

**Workhorse panel shows 🟡 idle forever** — Claude session isn't
actually using the MCP. Check that you ran `claude --mcp-config
~/.sciencedash/<projectId>/mcp-config.json`. A bare `claude` won't load
it.

**"directive 'revive_session' executed: {ok: false, error: 'tmux ...'"**
— `tmux` or `claude` not on the workhorse's PATH when cron runs cron's
PATH is minimal). Set them in setup.sh's crontab line, e.g.
`PATH=/home/$USER/.local/bin:/usr/local/bin:/usr/bin:/bin`.
