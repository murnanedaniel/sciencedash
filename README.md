# ScienceDash

A local-first research operating system for turning curiosity into papers.

You build small projects, declare a primary metric, log runs against hypotheses, and the dashboard nudges you when something is narrative-ready, stalled, or worth a paper. AI critical reviews and skeleton drafts run against your Claude subscription, not API credits.

Single user. Runs on `localhost`. Data is one SQLite file. Designed to be opened every morning as the first hour of work (`/today`).

---

## Quick start

Prereqs: **Node ≥ 20.19**, **Claude Code** installed and logged in to your Pro / Max plan.

```bash
cd web
npm install
npx prisma migrate dev          # one-time DB setup
npm run build && npm run start
```

Open <http://localhost:3000>.

Optional environment (in `web/.env.local`):

```
WANDB_API_KEY=...        # to ingest run metrics
GITHUB_PAT=...           # to track repo freshness
```

No `ANTHROPIC_API_KEY` — AI features go through Claude Code (`claude login`) so they bill against your subscription. Confirm on `/settings`: **Claude Code** should show a version, not "missing".

---

## Day-1 workflow

The fastest path from "I have an idea" to "I have a paper skeleton":

1. **Press `n`** (or click *New project*). Title + tags + one-line hypothesis. Create. Tag it `exploit` / `explore` / `system` if you want those groupings on the Portfolio page — there's a row of chips you can click.
2. On the project page, fill the §16.1 fields (hypothesis, FOM, timeline, next steps). Status `idea → active` is gated until they're set.
3. Switch to **Hypotheses & Runs**. Declare a primary metric (`tracking_efficiency`, higher better, threshold 0.99). Add a hypothesis with a 10 GPU-h budget.
4. Log runs as you go — name, GPU-h spent, metric values. The compute meter goes amber when you blow past budget.
5. When a hypothesis lands, set its verdict to `supported` and click **Spawn paper →**. A six-section skeleton appears in `/papers` linked to the hypothesis.
6. Click **AI first pass** on the paper to fill intro / method / experiments / results from your runs. Edit. **Polish** per section. **Export .tex** when ready for arXiv.

Every status change, paper spawn, hypothesis resolution, and accepted AI patch writes a row to the **Decision log** so you can see whether the random walk is moving forward (§2.4).

---

## What's where

| Route | What it's for |
|---|---|
| `/` | **Today** — first-hour ritual. Stalled / narrative-ready / recent runs / pending AI reviews. One card per zone. |
| `/projects` | List with status / tag / FOM / timeline / next-steps filters. |
| `/projects/[id]` | Three tabs: Overview (inline-edit fields, AI review), Hypotheses & Runs (cards + Pareto), Activity (decision log). |
| `/papers` | Kanban: skeleton → draft → internal → arxiv → submitted → published. |
| `/papers/[id]` | Section-by-section markdown editor, figure attachments, `.tex` export. |
| `/runs` | Sortable table across all hypotheses with dynamic metric columns. |
| `/reading` | Notes; paste an arXiv URL → autofill title / authors / abstract. |
| `/portfolio` | Outer-loop view: status summary, publication velocity, decision log, AI audit. |
| `/settings` | Claude Code / W&B / GitHub status, worker heartbeat, job log, prompt editor, per-project AI auto-review toggles. |

**Keyboard:** `⌘K` / `Ctrl-K` opens the command palette (jump to project, paper, or route). `/` also opens it when you're not typing. `?` opens the in-app help drawer. `g T` jumps to Today, `g P` Projects, `g A` Papers, `g R` Runs, `g N` Notes, `g O` Portfolio, `g S` Settings. `n` creates a new project. `Esc` closes any overlay. Inside the palette: arrow keys + Enter to navigate.

**Tags, not fixed categories.** Projects aren't categorized by a built-in `type` or `ingredient` field — everything is tags. The new-project and project-edit forms surface a row of clickable common-tag chips (`exploit`, `explore`, `system`, `tracking`, `ingredient`, `hl-lhc`, …) so you can classify with one click, but nothing is baked into the schema.

---

## How AI features work

Five surfaces — all explicit-click unless you opt in:

- **AI critical review** (project Overview). Sends the project state to Claude with the §16.6 contract: critical, not polite, returns actionable patches. Each patch renders with an Accept button on `/today` — one click applies the change and writes a Decision.
- **AI first pass** (paper detail). Generates intro / method / experiments / results from the linked hypothesis's runs and metrics. Conclusion + related-work stay empty for you to write (§10.2).
- **AI polish** (per paper section). Tightens prose without changing claims; preserves `TODO(...)` markers and inline math.
- **Portfolio audit** (`/portfolio`). Strategic balance review across the whole program — names projects to promote, park, or escalate.
- **Auto-review on stall** (per project, default off). When enabled, the worker invokes critical review automatically once a project goes 14+ days without a run / decision / check-in.

Every call writes a `JobRun` row visible on `/settings` with cost in USD. Subscription billing is internal to Claude Code — `costUsd` is the rate-card estimate, not what you actually pay.

The four prompt templates live at `web/src/lib/ai/prompts/*.md` and are versioned in git. You can override any of them in the database via the editor at the bottom of `/settings`; the on-disk version stays as the fallback.

---

## Background worker

Boots automatically on first request via Next 16's `instrumentation.ts`. Three ticks:

| Tick | Cadence | What it does |
|---|---|---|
| `wandb_pull` | 30 min | For every project with a `wandbEntity`/`wandbProject`, pulls metric values onto existing Run rows matched by `wandbRunId`. |
| `github_pull` | 60 min | For every project with a `githubRepoUrl`, fetches last commit SHA + date. |
| `stall_detect` | 60 min | Surfaces projects 14+ days idle on `/today`. For projects opted into auto-review, fires the AI review automatically. |

A heartbeat row lands every 5 minutes — visible on `/settings`. If a tick crashes mid-flight or the server is killed (SIGTERM), the in-flight `JobRun` rows are finalized with `error: "shutdown"` so the audit log never lies.

For things that should happen *now*, every tick has a "pull now" button on `/settings`.

---

## Backups

The whole database is `web/dev.db`. Backing up is `cp web/dev.db ~/Backups/sciencedash-$(date +%F).db` while the server is stopped. Artifacts (figures, checkpoints) live under `web/.data/artifacts/` — back that up too if you upload anything.

There's no migration story for moving between machines — just copy `dev.db` and the artifacts directory.

---

## Project philosophy

Why does this exist and why these specific features? Read `seed.md` (1338 lines) — it's the long-form internal memo that drove every design decision. Section §16 alone is the "research constitution" the dashboard enforces in code.

The full design plan with milestone breakdown is at `/root/.claude/plans/carefully-think-through-what-cozy-backus.md` (or wherever the plan file ended up).

## Dev setup, WSL2 launcher, schema regen

See `web/README.md`.
