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
- Slurm cron QOS access for the bridge keeper
- `claude` (Claude Code CLI) on PATH
- Outbound HTTPS reachability *(via a cloudflared quick-tunnel, see Phase 2b)*
- Follow the [bridge keeper](../tools/bridge-keeper/README.md) for scheduling with `scrontab`.

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

### 1.3 Start a local chat

Install the ambient context layer using **Settings → Ambient context — add a
machine**. This installs the `sciencedash` skill and transcript shipping.
Click **Chat with project → Copy command**, then paste it in your terminal.
Ask for project state; Claude should use the skill's `get_entity` tool with
this project's id.

---

## Phase 2 — Wire up compute

Two parallel tracks. Either order is fine.

### 2a — Link W&B project(s)

Project page → **W&B projects** card → Add (entity, name).

- **Entity** = your W&B entity (`<user>` or `<team>`)
- **Name** = the W&B project where this experiment's runs live

The background worker pulls W&B every few minutes. Multi-source is supported; if compute is split across projects, add each.

If your runs aren't tagged with the right hypothesis, you can move them via Hypotheses & Runs tab (or via MCP `move_run_to_hypothesis`).

### 2b — Register a Remote Control workhorse

Follow the [bridge keeper README](../tools/bridge-keeper/README.md) to install
and schedule the `perlmutter` bridge. Create a session on that bridge, then call
`register_rc_workhorse` with `projectId`, `bridgeName`, `rcSessionId`, `rcEnvId`
and optional `repo`. The project panel shows the session link and bridge state.
See [cluster integration](./cluster-integration.md) for registration and recovery.

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

By default, every dispatch action requires `ask`. To enable scheduled RC ticks, promote `workhorse_tick` to `auto`. Bridge recovery runs independently, except for stopped workhorses or paused/inactive projects.

The project's **Overview tab** has an **Autonomy** card listing every known action class with three radio buttons (Ask / Propose / Auto), plus number inputs for `spendCapGpuH` and `spendCapTokensUsd`.

Recommended starter:
- `workhorse_tick` → **Auto** (scheduled project progress)
- everything else → **Ask** (default)
- `spendCapGpuH` → your project's hypothesis budget total (e.g. 1000)
- `spendCapTokensUsd` → 5.0 (covers daily brain heartbeats with margin)

The card also has a "custom action class" field if you've shipped a dispatch tool that doesn't appear in the catalog yet.

A scheduled review agent fires on **2026-05-09** and proposes per-project promotions (ask → propose → auto) based on observed accept/reject patterns.

---

## Phase 5 — Verify the flywheel

End-to-end smoke checks, in order:

1. **Workhorses panel**: bridge fresh, state `live`, session link opens.
2. **Plan tab**: PROJECT_BRIEF reflects current DB state. MEMORY_LOG has the directive distillation.
3. **/today**: Digest panel respects your "be quiet" directive.
4. **Remote session**: ask Claude for project state through the `sciencedash` skill.
5. **Lifecycle**: Stop shows `stopped`; Resume re-enables recovery. Ticks update last tick after the configured interval.

Done. Autonomous loop is live: you write directives, the brain reads + remembers + surfaces, Perlmutter Claude does the work, the dashboard aggregates.

---

## Troubleshooting

### Bridge or workhorse unavailable

Check the bridge keeper job and heartbeat logs. Confirm the dashboard URL and
bearer token. For `needs_recreate`, create a session in the current bridge
environment and register it. For `stopped`, use Resume. See the
[keeper README](../tools/bridge-keeper/README.md) for restart and shutdown steps.

### Brain heartbeat returns "could not parse JSON"
The brain's reply was malformed. Check `/jobs/<jobId>` for the trace. Re-run with **Force** to retry.

### `claude --continue` exits non-zero on first run
Some older versions of `claude` error if there's no prior session. The dashboard's generated command uses `||` to fall back to fresh.

---

## Where this doc lives

Source: `docs/setup-tutorial.md` at the repo root. Edit it as you discover platform tweaks; the dashboard renders it live (60 s revalidate).

Reference docs:
- [tutorial.md](/docs) — how the platform actually works (concepts + reference)
- [cluster-integration.md](./cluster-integration.md) — wire-protocol level for workhorse setup
- [workhorse-protocol.md](./workhorse-protocol.md) — bridge heartbeat, recovery and tick rules
