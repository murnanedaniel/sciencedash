# Setup tutorial — getting a project to run autonomously

End-to-end walkthrough for taking an existing project (with hypotheses, notes, a linked repo) and getting the full autonomous loop spinning: brain heartbeats, remote workhorse, MCP-wired Claude sessions on both your laptop and the cluster.

Use this once per project. For day-to-day operation, see [tutorial.md](/docs).

> Replace `<placeholders>` as you go. Concrete examples assume:
> - Project: `<projectId>` — find it in the URL `/projects/<projectId>`
> - Cluster: `perlmutter`, user `<user>`, host alias `perlmutter.nersc.gov`
> - Repo slug: `<repo-slug>` (e.g. `colliderml-tracking`)

---

## Phase 0 — Prerequisites

**Before you start:**
- [ ] Dashboard running: `~/bin/start-sciencedash.sh dev` → <http://localhost:3000>
- [ ] Project already created with at least: title, hypothesis, primary metric, ≥1 hypothesis with a compute budget
- [ ] At least one **RepoLink** on the project (Quickstart-spawned or added manually)

**On the cluster host** (e.g. Perlmutter login node):
- `python3` (stdlib only — no pip installs needed)
- `tmux` *(required — also the fallback for sync on cron-less hosts)*
- `claude` (Claude Code CLI) on PATH
- Outbound HTTPS reachability *(via a cloudflared quick-tunnel, see Phase 2b)*
- Cron is **not required** — `setup.sh` falls back to a tmux-driven sync loop if `crontab` is missing (NERSC Perlmutter login nodes are cron-less)

---

## Phase 1 — Make the project addressable on your laptop

The dashboard needs to know the local path to the project's repo.

### 1.1 Clone the repo locally

Project page → **GitHub repos** card → click **Copy clone** on the repo row. Paste in your terminal. The default target is `~/Research/<repo-slug>` to match what auto-detect walks.

```bash
# pasted from the Copy clone button
git clone git@github.com:<owner>/<repo-slug>.git ~/Research/<repo-slug>
```

### 1.2 Set `localPath` on the project

Project page → **AI actions** card → the **Chat with project** row. If `localPath` is unset:
- Click **Auto-detect** — walks `~/Research`, `~/code`, `~/src`, `~/Projects` for a `.git/config` whose remote matches a project RepoLink. Resolves on first hit.
- Or click **Set path** and paste an absolute path manually.

After this, the row shows the resolved path inline.

### 1.3 Click **Chat with project ✨ → Persist .mcp.json**

This writes three things, idempotently:
- `<localPath>/.mcp.json` — the MCP server pointer with this project's id pinned.
- `<localPath>/.sciencedash/CHAT_CONTEXT.md` — a system-prompt primer telling Claude when to use `mcp__sciencedash__*` tools (vs git/filesystem). Without this, Claude treats "this project" as the cwd's git repo and starts running `git log` instead of calling MCP.
- `<localPath>/.gitignore` entries for both `.mcp.json` and `.sciencedash/`.

The generated `tmux` command uses these explicitly via `--mcp-config` and `--append-system-prompt "$(cat …/CHAT_CONTEXT.md)"`, so MCP loading and project-aware behaviour are guaranteed.

### 1.4 Verify

- `<localPath>/.mcp.json` exists with `mcpServers.sciencedash.url = http://localhost:3000/api/mcp`.
- `<localPath>/.sciencedash/CHAT_CONTEXT.md` exists.
- `<localPath>/.gitignore` contains `.mcp.json` and `.sciencedash/`.

**Test the chat surface**: click **Copy command**, paste the tmux line in your terminal, attach. At Claude's prompt: "What's the state of this project?" → it should call `mcp__sciencedash__get_project` and answer with hypotheses + counts. Detach with `Ctrl-b d`.

> **Gotcha (fixed)**: previously the generated command relied on Claude auto-loading `.mcp.json`, which sometimes silently didn't happen, causing Claude to inspect git history instead of calling MCP. The current command uses `--mcp-config` explicitly + `--append-system-prompt` from CHAT_CONTEXT.md so MCP is always loaded with the right project context.

> **Gotcha (fixed)**: previously the generated command was `claude --continue` which exited immediately on first-time use in a cwd. Current command uses `(claude --continue || claude)` to fall back gracefully.

---

## Phase 2 — Wire up compute

Two parallel tracks. Either order is fine.

### 2a — Link W&B project(s)

Project page → **W&B projects** card → Add (entity, name).

- **Entity** = your W&B entity (`<user>` or `<team>`)
- **Name** = the W&B project where this experiment's runs live

The background worker pulls W&B every few minutes. Multi-source is supported; if compute is split across projects, add each.

If your runs aren't tagged with the right hypothesis, you can move them via Hypotheses & Runs tab (or via MCP `move_run_to_hypothesis`).

### 2b — Bootstrap a workhorse on a remote host

#### 2b.1 Make the dashboard publicly reachable from the cluster

The cluster needs a URL pointing at the dashboard process running on your laptop (or wherever the dashboard lives). The recommended path is **`cloudflared` quick-tunnel**: one command on the laptop, get a free public HTTPS URL, point Perlmutter at it. No SSH tunnels, no login-node pinning, no ControlMaster gymnastics.

##### Recommended: cloudflared quick-tunnel

**Install once on the laptop** (Linux / WSL2):

```bash
curl -L --output /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

For macOS: `brew install cloudflared`.

**Each work session, open a fresh terminal and run:**

```bash
cloudflared tunnel --url http://localhost:3000
```

It blocks and prints a public URL like:

```
https://something-three-words.trycloudflare.com
```

Keep that terminal alive. Copy the URL — it's now your dashboard URL for the cluster side.

> **Why cloudflared over SSH tunnels:** the tunnel is bound to `cloudflared` on your laptop, not to a specific Perlmutter login node. Whichever login node you land on, `sync.py` and Claude both reach the same URL. Reconnects, round-robin, ControlMaster — all irrelevant.

> **Quick-tunnel gotcha:** each `cloudflared tunnel --url` invocation gets a *new* random subdomain. Restarting it (laptop sleep, terminal close) means a new URL — re-run setup.sh on the cluster (Phase 2b.6) with the new `DASHBOARD=` to re-generate `mcp-config.json`. Living with this for a few days is fine; for a stable URL across reconnects, see "Named tunnel" below.

##### Stable URL: named cloudflared tunnel (when you have a Cloudflare account + domain)

For a permanent URL (e.g. when the dashboard moves to a home box), register a free Cloudflare account, point a domain at it, and create a named tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create sciencedash
cloudflared tunnel route dns sciencedash dashboard.<your-domain>
cloudflared tunnel run sciencedash
```

Then the cluster's `dashboard_url` is `https://dashboard.<your-domain>`. Stable forever; works across machine reboots, laptop swaps, etc. This is the v2 deployment path.

##### Alternative: SSH reverse tunnel (no third party)

If you'd rather not route through Cloudflare, an SSH reverse tunnel still works, with two real tradeoffs: (1) login-node pinning matters because `perlmutter.nersc.gov` is a round-robin alias, and (2) the tunnel dies whenever the laptop sleeps. See [SSH-tunnel alternative](#alternative-ssh-reverse-tunnel-with-controlmaster) at the end for the full recipe.

#### 2b.2 Copy bootstrap files to the cluster

Settings page → **Cluster Claude integration** card → use the **Copy** buttons next to each step.

```bash
# from your laptop, in the ScienceDash repo root
ssh <user>@perlmutter.nersc.gov "mkdir -p ~/.sciencedash-bootstrap"
scp tools/workhorse-bootstrap/sync.py tools/workhorse-bootstrap/setup.sh \
  <user>@perlmutter.nersc.gov:~/.sciencedash-bootstrap/
```

#### 2b.3 SSH into the cluster + clone the project repo

```bash
ssh <user>@perlmutter.nersc.gov
git clone git@github.com:<owner>/<repo-slug>.git ~/<repo-slug>
```

(Use the same `~/<repo-slug>` path you'll reference in `config.json` below.)

#### 2b.4 Run the bootstrap

Use the cloudflared URL from Phase 2b.1 as `DASHBOARD`:

```bash
DASHBOARD=https://something-three-words.trycloudflare.com HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

(If you went the SSH-tunnel route instead, use `DASHBOARD=http://localhost:3000`.)

It will print one of:
- `==> crontab entry installed: …` (host has cron — typical machines)
- `==> cron not available — sync loop running in tmux session 'sd-sync'` (NERSC Perlmutter)

…and then `==> probing dashboard … reachable ✓` if the URL is live.

If you see `Neither crontab nor tmux is available`, the host is too restrictive — talk to me and we'll sort it.

> **Gotcha (NERSC)**: the tmux fallback is reaper-class fragile, same as bare login-node processes. In practice your existing tmux Claude sessions survive for weeks; the sync tmux is smaller and likely survives at least as long. The "right" reaper-immune solution is `scrontab` with `--qos=workflow`, but that requires applied-for-and-granted workflow-QoS permission. Defer until you've actually felt the pain.

> **Gotcha (NERSC, the silent kind)**: `ssh perlmutter` round-robins across 40 login nodes. Each tmux server is **per-host** (`/run/tmux/<UID>/default`), but `~/.sciencedash/sync.log` lives on shared NFS. If you re-run `setup.sh` after your earlier ssh dropped, you'll likely land on a different login node — and end up with **two** `sd-sync` loops. They each post to the dashboard, but only one of them sees the revived `sd-<projectId>` tmux session, so the dashboard flaps between 🟢 alive and 🔴 dead. setup.sh now refuses to start if a recent `active-host.txt` heartbeat names a different login node; if it triggers, follow the `ssh <host> tmux kill-session -t sd-sync` hint it prints before re-running.

#### 2b.5 Register your project in `config.json`

```bash
$EDITOR ~/.sciencedash/config.json
```

Replace contents with (use your cloudflared URL from Phase 2b.1; adjust for your project):

```json
{
  "dashboard_url": "https://something-three-words.trycloudflare.com",
  "host": "perlmutter",
  "projects": [
    {
      "projectId": "<projectId>",
      "sessionName": "sd-<projectId-prefix-8>",
      "repo": "/global/homes/<u>/<user>/<repo-slug>"
    }
  ]
}
```

(If you went the SSH-tunnel route instead, `dashboard_url` is `http://localhost:3000`.)

The `sessionName` MUST match what your laptop's "Chat with project" generates (`sd-` + first 8 chars of projectId). The dashboard's Revive button looks up tmux sessions by this name.

#### 2b.6 Re-run setup.sh (idempotent)

```bash
DASHBOARD=https://something-three-words.trycloudflare.com HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

This time it generates `~/.sciencedash/<projectId>/<sessionName>/mcp-config.json` with the right `X-Workhorse-Id` header and the public URL, and respawns the `sd-sync` tmux session. (`mcp-config.json` lives in a per-session subdir so multiple sessions for the same project — see Phase 2b.10 — each have their own.)

> **If your cloudflared URL changes** (laptop sleep → restart of `cloudflared tunnel --url …`): re-run this step with the new `DASHBOARD=` to regenerate the per-session mcp-config.json. Until you do, the workhorse Claude will be talking to a dead URL.

#### 2b.7 Verify sync round-trip

```bash
sleep 65 && tail -10 ~/.sciencedash/sync.log
```

You want lines like:
```
2026-04-26T... [<projectId>] ok ack=1 directives=0
```

If you see `connection error` — the dashboard URL isn't reachable. For cloudflared: check that the `cloudflared tunnel --url …` terminal on your laptop is still running. For SSH-tunnel: check that the tunnel is up and pinned to the right login node.

#### 2b.8 Confirm on the dashboard

Refresh the project page. The **Workhorses** panel should show:

```
🟡  perlmutter:sd-<prefix>    host: <fresh>m ago · claude: never
```

🟡 idle = host fresh, no Claude calls yet. That's expected — we haven't started the Claude session.

#### 2b.9 Start the project's Claude session on the cluster

The dashboard's Workhorses panel has a **Copy start** button per workhorse (visible once the first sync has registered the workhorse). Click it; you get the full tmux command with `--mcp-config` and `--append-system-prompt` already wired:

```
tmux new -As <sessionName> 'cd <repo> && (claude --continue --mcp-config ~/.sciencedash/<projectId>/<sessionName>/mcp-config.json --append-system-prompt "$(cat ~/.sciencedash/<projectId>/CHAT_CONTEXT.md 2>/dev/null)" 2>/dev/null || claude --mcp-config ~/.sciencedash/<projectId>/<sessionName>/mcp-config.json --append-system-prompt "$(cat ~/.sciencedash/<projectId>/CHAT_CONTEXT.md 2>/dev/null)")'
```

(The Copy attach button next to it copies `tmux attach -t <sessionName>` for re-attaching later.)

Paste in your Perlmutter SSH session in a SEPARATE tmux from `sd-sync`. At Claude's prompt: "What's the state of this project?" — should call `mcp__sciencedash__get_project` and answer from the DB, not run `git log`.

Detach (`Ctrl-b d`).

> **Note**: Copy start only appears after the workhorse has synced once with the latest sync.py (which sends the repo path) AND the latest setup.sh has run (which writes CHAT_CONTEXT.md). If you bootstrapped before either of those landed, re-scp them and re-run setup.sh on the workhorse.

#### 2b.10 Verify 🟢 alive

Refresh the dashboard. Workhorses panel should flip:
```
🟢  perlmutter:sd-<prefix>    host: <fresh>m ago · claude: <fresh>m ago
```

🟢 = both signals fresh. The MCP tool calls Claude made (incl. its initialization probe) bumped `lastClaudeBeat` via the `X-Workhorse-Id` header.

#### 2b.11 (Optional) Run multiple sessions for the same project

If you want two parallel Claudes on the same workhorse (one building spacepoints, one scaffolding models), the trick is **one git worktree per session, not one repo shared between them**. Two reasons:

1. `claude --continue` resumes the most recent session **by cwd** — two Claudes in the same cwd will pick up each other's chat history and look like one session in two windows.
2. They'd also stomp each other's working-tree edits if both are touching files.

So: create a worktree per session, then point each session at its own worktree.

```bash
# On the workhorse, from your existing repo:
cd /global/cfs/.../colliderml-tracking
git worktree add ../colliderml-tracking-models   models-branch     # or any branch name
git worktree add ../colliderml-tracking-data     data-branch
```

Then add per-session entries to `~/.sciencedash/config.json` with the **same `projectId`, different `sessionName`, different `repo`**:

```json
{
  "dashboard_url": "...",
  "host": "perlmutter",
  "projects": [
    { "projectId": "<projectId>", "sessionName": "sd-<prefix>",        "repo": "/global/cfs/.../colliderml-tracking" },
    { "projectId": "<projectId>", "sessionName": "sd-<prefix>-data",   "repo": "/global/cfs/.../colliderml-tracking-data" },
    { "projectId": "<projectId>", "sessionName": "sd-<prefix>-models", "repo": "/global/cfs/.../colliderml-tracking-models" }
  ]
}
```

Re-run `setup.sh`. Three `Workhorse` rows appear on the dashboard, each with its own `<projectId>/<sessionName>/mcp-config.json` and its own copy-start command (pointing at its worktree). They share the project's `CHAT_CONTEXT.md`, `MEMORY_LOG.md`, and `HUMAN_DIRECTIVE.md` — same project, different concurrent threads of work, *independent* file-edit and Claude-session state.

> **If you really want them in the same cwd** (no worktree, just two Claudes side by side): drop `--continue` from the start command before pasting, so each starts a fresh chat. Otherwise the second Claude latches onto the first's session and confuses you.

---

## Phase 3 — Tell the brain what's load-bearing

The brain runs as a stateless `claude -p` cycle, seeded by a memory file. You steer it with `HUMAN_DIRECTIVE.md`.

### 3.1 Write a directive on the Plan tab

Open the project's **Plan tab** → top card is the **HUMAN_DIRECTIVE** editor. Paste your priorities into the textarea and click **Save directive**. The next brain heartbeat consumes it (clears the field, sets `brainDirectiveConsumedAt`).

If `localPath` is set, the dashboard also mirrors the directive to `<localPath>/.sciencedash/HUMAN_DIRECTIVE.md` so a terminal Claude in that directory sees the same instruction.

(Power-user alternative: write directly to `<localPath>/.sciencedash/HUMAN_DIRECTIVE.md` from your shell. The brain reads either source, DB-canonical first.)

### 3.2 Run a heartbeat

Project page → AI actions → **Brain heartbeat 🧠 → Force**.

Expected:
- Cycle reads the directive, archives it as `HUMAN_DIRECTIVE.<timestamp>.md`
- Posts at most one acknowledgement message in the feed
- Updates MEMORY_LOG with the directive's distillation
- Cost ~$0.13

Plan tab now shows the directive distillation in MEMORY_LOG.

---

## Phase 4 — Set the autonomy leash

By default, every dispatch action requires `ask`. To let the brain self-heal Perlmutter when its tmux Claude gets killed, promote `revive_session` to `auto`.

The project's **Overview tab** has an **Autonomy** card listing every known action class with three radio buttons (Ask / Propose / Auto), plus number inputs for `spendCapGpuH` and `spendCapTokensUsd`.

Recommended starter:
- `revive_session` → **Auto** (low-stakes recovery)
- everything else → **Ask** (default)
- `spendCapGpuH` → your project's hypothesis budget total (e.g. 1000)
- `spendCapTokensUsd` → 5.0 (covers daily brain heartbeats with margin)

The card also has a "custom action class" field if you've shipped a dispatch tool that doesn't appear in the catalog yet.

A scheduled review agent fires on **2026-05-09** and proposes per-project promotions (ask → propose → auto) based on observed accept/reject patterns.

---

## Phase 5 — Verify the flywheel

End-to-end smoke checks, in order:

1. **Workhorses panel**: 🟢 alive, both beats <1 min.
2. **Plan tab**: PROJECT_BRIEF reflects current DB state. MEMORY_LOG has the directive distillation.
3. **/today**: Digest panel respects your "be quiet" directive.
4. **Cluster session interactivity**: `tmux attach -t sd-<prefix>` on Perlmutter. Ask Claude something requiring MCP — answer should cite real records.
5. **Revive smoke test**:
   - On Perlmutter (in a fresh shell): `tmux kill-session -t sd-<prefix>`
   - On the dashboard: panel flips 🔴 within ~3 min
   - Click **Revive**
   - Within ~2 min: panel flips 🟢

Done. Autonomous loop is live: you write directives, the brain reads + remembers + surfaces, Perlmutter Claude does the work, the dashboard aggregates.

---

## Troubleshooting

### "tmux: [exited]" right after pasting Chat-with-project command
Your installed `claude` doesn't handle `--continue` with no prior session. The dashboard now generates `(claude --continue || claude)` — pull latest, recopy.

### "crontab: command not found" running setup.sh
NERSC login nodes don't ship cron. Pull latest setup.sh; it falls back to a tmux-driven sync loop on cron-less hosts.

### `sync.log` shows `connection error to <dashboard URL>`
The dashboard URL isn't reachable from the cluster.

If you're on cloudflared (recommended path):
- Check that the `cloudflared tunnel --url http://localhost:3000` terminal on your laptop is still running.
- If you restarted it, the public URL changed → re-run the bootstrap on Perlmutter with the new URL:
  ```bash
  DASHBOARD=https://new-three-words.trycloudflare.com HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
  ```
  Then update `~/.sciencedash/config.json` so `dashboard_url` matches.

If you're on the SSH-tunnel path: reopen the tunnel and confirm it's on the same login node where `sd-sync` is running. See [SSH-tunnel alternative](#alternative-ssh-reverse-tunnel-with-controlmaster).

### Workhorses panel stuck at 🟡 idle forever
Your cluster Claude isn't actually using the MCP. Verify the `--mcp-config` flag is in the tmux command (a bare `claude` won't load it).

### Workhorses panel stuck at ⚫ unreachable
Either the `sd-sync` tmux session died (cron-less host's reaper got it), or your dashboard URL is unreachable.

```bash
ssh <user>@perlmutter.nersc.gov
DASHBOARD=https://<your-cloudflared-or-localhost-url> HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

`setup.sh` is idempotent — kills any stale `sd-sync`, respawns it, regenerates the per-project mcp-config.json with the current URL.

### Brain heartbeat returns "could not parse JSON"
The brain's reply was malformed. Check `/jobs/<jobId>` for the trace. Re-run with **Force** to retry.

### `claude --continue` exits non-zero on first run
Some older versions of `claude` error if there's no prior session. The dashboard's generated command uses `||` to fall back to fresh.

---

## Alternative: SSH reverse tunnel with ControlMaster

If you'd rather not route traffic through Cloudflare, an SSH reverse tunnel works — with two real tradeoffs: (1) login-node pinning matters because `perlmutter.nersc.gov` is a round-robin alias, and (2) the tunnel dies whenever the laptop sleeps.

**One-time setup**: add to your laptop's `~/.ssh/config`:

```
Host perlmutter
    HostName perlmutter.nersc.gov
    User <user>
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 4h
```

ControlMaster pins all `ssh perlmutter` invocations to one underlying connection (and one login node) for 4 hours.

**Per-session**:

```bash
# Terminal 1 (laptop) — establish master + reverse tunnel together:
ssh -R 3000:localhost:3000 perlmutter

# Terminal 2 (laptop) — reuses the master; lands on the SAME login node:
ssh perlmutter
```

If you want to add a tunnel to an *already-open* SSH session (no ControlMaster set up yet), use SSH's `~C` escape sequence — at the Perlmutter prompt, on a new line, type `~C` (tilde then capital C; tilde must be the first char), then `-R 3000:localhost:3000` at the `ssh>` prompt.

Verify on Perlmutter:

```bash
curl -s http://localhost:3000/api/mcp | head -c 200
```

Then set `dashboard_url` in `~/.sciencedash/config.json` to `http://localhost:3000`. Note: `setup.sh`'s `DASHBOARD=` env var should match.

> **Gotchas with this path**: laptop sleep / ControlMaster expiry / `login25` reboot all break the tunnel. Recovery: re-establish the tunnel and re-run `setup.sh` if `sd-sync` ended up stranded on a now-disconnected login node. The cloudflared path avoids all of these.

---

## Where this doc lives

Source: `docs/setup-tutorial.md` at the repo root. Edit it as you discover platform tweaks; the dashboard renders it live (60 s revalidate).

Reference docs:
- [tutorial.md](/docs) — how the platform actually works (concepts + reference)
- [cluster-integration.md](./cluster-integration.md) — wire-protocol level for workhorse setup
- [workhorse-protocol.md](./workhorse-protocol.md) — outbox/inbox JSON shapes + directive vocabulary
