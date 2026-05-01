# ScienceDash — how it actually works

A platform for managing research portfolios where Claude Code does the work and the dashboard provides the substrate. This is the manual.

> Quick navigation:
> [What it is](#what-it-is) ·
> [Daily flow](#a-day-in-the-life) ·
> [Setting up a project](#setting-up-a-project) ·
> [The brain](#the-project-brain) ·
> [Workhorses](#workhorses) ·
> [MCP](#mcp-the-shared-substrate) ·
> [Autonomy](#autonomy-spectrum) ·
> [Skills reference](#skills-reference) ·
> [Cookbook](#cookbook) ·
> [Troubleshooting](#troubleshooting)

---

## What it is

ScienceDash is a **cockpit + portfolio brain** for research. It is **not** an AI agent runtime — your Claude Code sessions are. ScienceDash provides:

- A **shared data substrate** (projects, hypotheses, runs, decisions, notes, papers).
- An **MCP server** so any Claude session — local terminal, dashboard buttons, remote workhorse — reads and writes the same project state.
- **Per-project brains** that wake on signal, triage what's worth your attention, and surface decisions on /today.
- A **workhorse protocol** to integrate long-running Claude Code sessions on remote hosts (Perlmutter, Vast, …).

The design axiom: **native Claude Code beats any harness**. ScienceDash's job is to remove context-switching friction and provide the cross-cutting state no native tool holds — not to replace Claude.

---

## Three interaction modes

| Mode | When | Where | Cost |
|---|---|---|---|
| **Skill button** | A pattern you do 1–2× per day — lit review, critical review, brain heartbeat. Output lands attached to the project. | Dashboard buttons | One-shot Claude w/ pre-curated prompt + tool surface |
| **Casual nudge** | "Quick question while scrolling /today" — what's the state of run X, did I link a paper for Y. | Chat-with-project button (terminal) | One sustained Claude Code session per project |
| **Deep work** | Sustained debugging, designing, writing. | Terminal Claude Code (laptop or workhorse) | Long-running session, rich context |

These don't conflict. They serve different mental modes (peek / ask / work).

---

## A day in the life

**Morning (90 seconds):**
1. Open ScienceDash → **/today**.
2. Scan the **Digest panel** at the top: which active projects had W&B activity overnight, which have unresolved decisions, what brains surfaced.
3. Click the highest-priority item. It deep-links to the project's Feed tab.

**Mid-day (no dashboard interaction):**
1. You're in your terminal, in a project repo. Run `claude --continue` (the chat-button copy command set this up). Claude has the ScienceDash MCP loaded.
2. Ask "what hypotheses haven't I tested yet?" → Claude calls `list_hypotheses`, answers in your terminal.
3. Decide to escalate budget on H3. Tell Claude. It calls `record_decision`. You never opened the dashboard.

**Evening (30 seconds):**
1. /today shows what's changed: decisions you logged, runs that completed, brain notes.

Total dashboard UI time: under 3 minutes. Real work happens where you already are.

---

## Setting up a project

A project goes through these states:

1. **Create** — `/projects/new`. Title + initial fields (description, hypothesis, primary metric, tags). The project starts with status=`idea`.

2. **Promote to active** — Status → `active` once you have a working hypothesis and you're committing compute.

3. **Link sources**:
   - **GitHub repo** — Overview tab → "GitHub repos" card → "Add repo". Or click **Quickstart repo ✨** to spawn a new private repo from your template (set `SCIENCEDASH_REPO_TEMPLATE` env var).
   - **W&B project** — Overview tab → "W&B projects" card → "Add". Multiple sources per project are supported.
   - **Local repo path** — In the AI actions card, click **Chat with project → Auto-detect** (walks `~/Research/`, `~/code/`, etc.) or paste an absolute path manually. Required for Chat-with-project, BrainHeartbeat memory file mirroring, and the workhorse bootstrap.

4. **Add hypotheses** — Hypotheses & Runs tab → "New hypothesis". Each gets a compute budget in GPU-hours. Runs (synced from W&B) are attached to one hypothesis at a time.

5. **Add a primary metric** — Hypotheses & Runs tab → "Metric definitions". Pick one as primary; the brain uses it for "is this run on track" decisions.

6. **(Optional) Bootstrap a workhorse** — for remote compute. See [Workhorses](#workhorses).

---

## /today — the daily entry point

The top of /today is the **Digest panel**: unread `AgentMessage`s across all `active`+`blocked` projects, severity-sorted (`blocker` > `decision` > `suggestion` > `info`). Cap is 5 items. Each is a one-line preview that links into the source project's Feed tab.

The **Run brains** button next to the digest fires a brain heartbeat across all active projects in sequence. Each project's heartbeat respects its 5-minute anti-burn floor; recent heartbeats skip. **Force** ignores the floor.

Below the digest:
- **Stalled** — active projects untouched for ≥14 days.
- **Narrative-ready** — projects whose `narrativeReadiness` is past `figures_exist`.
- **Recent runs** — newest 5 W&B-synced runs.
- **Recent AI check-ins** — latest 5 critical-review outputs.
- **Recent activity** — newest 5 manual check-ins.

---

## Project page anatomy

Five tabs on `/projects/<id>`:

### Overview

The status / description / fields / GitHub / W&B / Workhorses / Tags / Primary metric / **AI actions** / Danger zone. Most setup happens here.

The **AI actions** card holds the four day-to-day surfaces:
- **Chat with project** — open Claude Code in your terminal, in this repo, with ScienceDash MCP pre-loaded. Copy command, paste, attach.
- **Brain heartbeat** — run one supervisor cycle. Reads project state via MCP, surfaces what matters, updates rolling memory. Default-silent. Cost ~$0.13/cycle.
- **Critical review** — §16.6. MCP-grounded multi-turn agent. Returns a recommendation (narrow / promote_to_paper / park / escalate_budget / continue) with `evidence: [{ref, quote}]` and proposedPatches you accept one-by-one. Cost ~$0.20/run.
- **Literature review** — proposes a starter reading list sized to what's load-bearing. Verified against arXiv; unverified citations are kept but flagged. Cost ~$0.10–1.20/run depending on search depth.

### Hypotheses & Runs

One row per hypothesis, with budget vs spent, runs, metrics. Where you "do science" in the structured sense.

### Literature

Notes (mostly papers, also books/talks/threads) attached to this project. Click any title to open the source URL or arXiv search.

### Plan

The brain's two-tier memory side-by-side:
- **Tier 1 — PROJECT_BRIEF** — frozen, derived from the DB each cycle.
- **Tier 2 — MEMORY_LOG** — rolling, brain-maintained. ≤2K chars. Lossy by design.

Empty until you've run a brain heartbeat.

### Feed

Every `AgentMessage` posted to this project, newest first. Each message has:
- A **severity** colored left border (info / suggestion / decision / blocker).
- A **kind** tag (note / alert / status / digest / directive).
- A **source** tag (e.g. `project-brain`, `review-agent`, `workhorse-perlmutter:sd-...`, `local-claude`).

Mark-read / Delete buttons per row, and a "Mark all read" button.

### Activity

Older check-ins, decisions, and the project's chronological history.

---

## The project brain

Each project has a **stateless LLM call seeded by a stateful memory file** — not a long-running session. Architecture from the [Deep Researcher Agent paper](https://arxiv.org/abs/2604.05854) (§3).

**Two-tier memory (≤5K chars total):**

- **PROJECT_BRIEF** (≤3K, frozen) — auto-derived from DB: title, hypothesis, primary metric, tags, narrative state, blockers, counts.
- **MEMORY_LOG** (≤2K, brain-maintained) — `## Key Results` (FIFO when over 1.2K) and `## Recent Decisions` (most recent 15 entries).

Lossy by design. Each cycle is a fresh `claude -p` call. Conversation history does NOT persist between cycles. Cost stays flat over months.

### What it does on a cycle

1. Reads the brief + memory log.
2. Reads any pending `HUMAN_DIRECTIVE.md` (see below).
3. Uses ScienceDash MCP to investigate current state (runs, decisions, recent feed messages).
4. Decides whether anything is worth surfacing. **Default: silence.** A successful cycle that posts zero messages is a successful cycle.
5. Writes terse, decision-shaped messages to the feed (≤3 per cycle).
6. Updates the memory log.

### Triggering it

Three options:
- **Manual** — click "Brain heartbeat 🧠" in the Overview AI actions card, or "Run brains" on /today.
- **Force** — bypass the 5-minute anti-burn floor.
- **Future**: event-driven (W&B run completes, new note added, new directive). Currently manual-only.

### Anti-burn

5-minute minimum interval between cycles per project. The Deep Researcher paper uses exponential backoff up to 30 minutes for empty cycles; we use a flat 5-minute floor in V1.

### Sending the brain a directive

Drop a markdown file at `<localPath>/.sciencedash/HUMAN_DIRECTIVE.md`:

```bash
echo "Focus: spacepoint blocker. Stop nagging about narrative-readiness." > <repo>/.sciencedash/HUMAN_DIRECTIVE.md
```

The brain consumes it on the next cycle and archives it as `HUMAN_DIRECTIVE.<timestamp>.md`.

---

## Workhorses

A **workhorse** is a long-running Claude Code session on a remote host (Perlmutter login node, Vast box, your home server). It reads/writes the same project state via MCP.

### Liveness — two-tier

| Signal | Mechanism | UI state |
|---|---|---|
| `host_reachable` | Sync daemon's per-minute heartbeat in outbox | 🟢 / ⚫ |
| `claude_active` | Direct MCP tool calls update lastClaudeBeat via `X-Workhorse-Id` header | 🟢 / 🟡 / 🔴 |

Four UI states:
- **🟢 alive** — both fresh
- **🟡 idle** — host fresh, claude beat 10–60 min old (might just be waiting)
- **🔴 dead** — host fresh, claude silent past threshold → "Revive" button appears
- **⚫ unreachable** — sync daemon stale (cron itself died)

### Bootstrapping one

See [docs/cluster-integration.md](./cluster-integration.md) for the full guide. Quickstart:

```bash
# On the laptop:
ssh -R 3000:localhost:3000 -N user@host           # reverse tunnel so cluster can reach dashboard
scp tools/workhorse-bootstrap/{sync.py,setup.sh} user@host:~/.sciencedash-bootstrap/
ssh user@host
DASHBOARD=http://localhost:3000 HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh
```

Then edit `~/.sciencedash/config.json` on the host to add projects, re-run setup.sh (idempotent), and start sessions:

```bash
tmux new -As sd-<projectId> "cd <repo> && claude --mcp-config ~/.sciencedash/<projectId>/mcp-config.json"
```

### Reviving

When the cluster's reaper kills your tmux Claude, the panel flips 🔴 within ~3 min. Click **Revive**. The dashboard queues a `revive_session` directive; the next cron tick (≤1 min) on the host runs `tmux kill-session ...; tmux new -d -s <session> "claude --continue"`. Round-trip ≤2 minutes.

If even cron dies (rare): SSH in, re-run `setup.sh`. Idempotent.

---

## MCP — the shared substrate

The MCP server lives at `/api/mcp` on the dashboard. JSON-RPC 2.0. Three protocol methods: `initialize`, `tools/list`, `tools/call`.

Currently exposes ~20 tools across read / write / dispatch / spawn:

### Read

`list_projects`, `get_project`, `list_runs`, `summarise_run`, `list_notes`, `list_decisions`, `list_check_ins`, `list_hypotheses`, `get_hypothesis`, `list_messages`, `list_workhorses`.

### Write

`create_check_in`, `record_decision`, `add_note`, `update_hypothesis_status`, `move_run_to_hypothesis`, `post_message`, `mark_message_read`, `queue_directive`.

### Dispatch (autonomy-gated)

`dispatch_workhorse` — the brain's path for non-trivial mutations. Consults Project.autonomyJson; default-conservative.

### Spawn (existing in-app flows)

`start_literature_review`, `start_critical_review` (wrappers exposing the existing JobRun flows so cluster Claude can fire them).

Inspect the live catalog:

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

### Local Claude using the MCP

The Chat-with-project button generates a one-time tmux command. It also offers **"Persist .mcp.json"** which writes `<localPath>/.mcp.json` so any subsequent `claude` invocation in that directory auto-loads the MCP.

### Cluster Claude using the MCP

`setup.sh` writes per-project `~/.sciencedash/<projectId>/mcp-config.json` files that include the `X-Workhorse-Id` header. So every tool call doubles as a `claude_active` heartbeat. **No separate hook needed.**

---

## Autonomy spectrum

Per-project leash on what the brain can fire on its own:

```json
{
  "auto":    ["revive_session"],   // fire immediately, log it
  "propose": [],                   // fire AND post a "doing X, cancel within 60s" heads-up
  "ask":     [],                   // surface a permission-needed alert; do NOT fire
  "spendCapGpuH":      50,
  "spendCapTokensUsd": 5.0
}
```

**Default-conservative**: anything not explicitly listed in `auto` or `propose` is treated as `ask`. New projects start with everything asking.

### When to promote

Suggested rules:
- **ask → propose**: after 3 consecutive accepted invocations in 14 days.
- **propose → auto**: after 10 consecutive accepted invocations and zero rejections.

A scheduled review agent runs every ~2 weeks and proposes per-project defaults based on observed accept/reject patterns. Look for `proposals/<date>-autonomy-defaults.md` PRs.

### Action class catalogue

Conventional names the dispatch tools use (extend as you ship more dispatch types):

- `revive_session` — restart a workhorse's tmux Claude
- `restart_run` — re-launch a failed/OOMed W&B run
- `launch_sweep` — kick off a W&B sweep
- `escalate_budget` — bump a hypothesis's compute budget
- `narrow_scope`, `promote_to_paper`, `park_hypothesis` — high-stakes Decision-row mutations

Pick consistent names per dispatch shape so leashes stay meaningful over time.

---

## Skills reference

| Surface | What it does | Trigger | Cost (approx) |
|---|---|---|---|
| **Quickstart repo** | Spawn a private GitHub repo from a template, let Claude scaffold it from project context | Project page → GitHub repos card | $0.20–0.80 |
| **Chat with project** | Generate the tmux+claude command with MCP loaded | Project page → AI actions | free (just generates a command) |
| **Brain heartbeat** | One supervisor cycle: triage state, surface to feed, update memory | Project page or /today | $0.10–0.20/cycle |
| **Critical review** | MCP-grounded post-mortem with evidence + proposed patches | Project page → AI actions | $0.15–0.30 |
| **Literature review** | Propose papers, verify against arXiv, backfill unverified existing notes | Project page → AI actions | $0.10–1.20 |

---

## Cookbook

### Start a new project from scratch

1. `/projects/new` → fill title, description, hypothesis, primary metric, tags. Save.
2. **Quickstart repo** to spawn a fresh private repo (uses `SCIENCEDASH_REPO_TEMPLATE`).
3. Watch `/jobs/<id>` while Claude scaffolds.
4. Click **Set path** in the Chat-with-project area; auto-detect or paste the absolute path to the cloned repo.
5. Add a few starter notes via **Literature review**.
6. (Optional) Bootstrap a workhorse if compute lives elsewhere.

### Get a critical review and apply patches

1. Project page → **Critical review** button.
2. Wait ~30 s. The result lands as both a CheckIn (with proposedPatches) and an AgentMessage on the Feed tab.
3. Activity tab shows the CheckIn with each proposedPatch as an "Apply" button (one click per patch).
4. The view-trace link from the button takes you to `/jobs/<id>` to see the agent's full investigation.

### Hook up Perlmutter Claude

1. SSH-tunnel: `ssh -R 3000:localhost:3000 -N perlmutter`.
2. `scp tools/workhorse-bootstrap/{sync.py,setup.sh} perlmutter:~/.sciencedash-bootstrap/`.
3. On Perlmutter: `DASHBOARD=http://localhost:3000 HOST=perlmutter bash ~/.sciencedash-bootstrap/setup.sh`.
4. Edit `~/.sciencedash/config.json` to register your projects.
5. Re-run setup.sh.
6. `tmux new -As sd-<projectId> "cd <repo> && claude --mcp-config ~/.sciencedash/<projectId>/mcp-config.json"`.
7. The Workhorses panel on the project page should flip 🟢 within ~2 min.

### Send the brain a one-shot directive

```bash
echo "Stop pinging me about literature gaps until the spacepoint blocker is unblocked." \
  > <repo>/.sciencedash/HUMAN_DIRECTIVE.md
```

Run **Brain heartbeat** (or wait for the next manual run). Brain reads, archives, applies.

### Unify a chat across surfaces

The dashboard's Chat-with-project button and your terminal's `claude --continue` resume **the same Claude Code session ID**. Pick whichever surface fits the moment. Plan tab in the dashboard shows the brain's memory; `~/.claude/plans/` on disk holds your terminal-session plan docs.

---

## Troubleshooting

### "tools/list returned 0 tools"
The dashboard isn't running. `~/bin/start-sciencedash.sh dev`.

### Workhorse stuck at 🟡 idle forever
Cluster Claude isn't actually using the MCP. Check that you ran `claude --mcp-config ~/.sciencedash/<projectId>/mcp-config.json` — a bare `claude` won't load it.

### Brain heartbeat reports "schema validation errors"
You're on a stale Prisma client. `npx prisma generate` and restart.

### Critical review hallucinates content
You're on the v1 prompt. Pull latest; the v2 critical review is MCP-backed and grounds findings in real evidence.

### Workhorse 🔴 dead immediately after a successful Revive
`tmux` or `claude` not on cron's PATH. Edit your crontab line to set `PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin` before the sync.py call.

### Brain memory log is empty after a heartbeat
The brain returned no content (or an unparseable response). Check `/jobs/<jobId>` for the trace. The 5-minute anti-burn floor will skip the next attempt; use **Force** to retry.

### "no Project found" when calling MCP from the cluster
The reverse SSH tunnel dropped. Restart `ssh -R 3000:localhost:3000 -N perlmutter`.

### Doomsday — workhorse host's cron got reset
SSH in, run `bash ~/.sciencedash-bootstrap/setup.sh` again. Idempotent. ~30 seconds.

---

## Architecture in one diagram

```
            ┌───────────────────────┐
            │   GLOBAL DIGEST       │   /today: cross-project triage
            │   (DigestPanel)       │
            └──────────┬────────────┘
              ┌────────┼─────────┐
              ▼        ▼         ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐
         │PROJECT  │ │PROJECT  │ │PROJECT  │   per-project brains
         │ BRAIN   │ │ BRAIN   │ │ BRAIN   │   (2-tier memory, heartbeat)
         └────┬────┘ └─────────┘ └─────────┘
              │
   ┌──────────┼─────────────────────────┐
   ▼          ▼                          ▼
┌──────┐  ┌──────────┐               ┌──────────┐
│ W&B  │  │ CLUSTER  │               │ LOCAL    │   workers
│ APIs │  │ CLAUDE   │               │ TERMINAL │
│      │  │(Perlmutter│               │ CLAUDE   │
│      │  │ tmux,     │               │          │
│      │  │ revivable)│               │          │
└──────┘  └──────────┘               └──────────┘
                  ▲                        ▲
                  └──────── MCP ───────────┘
```

Brains and workers communicate **only via the project DB** (read+write through MCP). No direct conversation between Claudes. Decoupled, durable, async by construction.

---

## Reference docs

- [Cluster integration](./cluster-integration.md) — bootstrap, SSH tunnel, registration.
- [Workhorse protocol](./workhorse-protocol.md) — wire format for outbox/inbox/sync.

## Architecture decisions

ScienceDash v2 was specified in `~/.claude/plans/yup-merge-in-then-atomic-breeze.md` and shipped in commits `2d58e3d` through `16b32ae` (April 2026). The plan file captures the design conversation — read it for the *why* behind these choices.
