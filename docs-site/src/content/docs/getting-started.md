---
title: Getting started
description: Install ScienceDash, set up auth, and go from idea to paper skeleton.
---

ScienceDash runs entirely on your machine. This page gets you from a clean clone
to a populated dashboard. For the deeper "how it actually works" tour, read
[How it works](/sciencedash/tutorial/).

## Prerequisites

- **Node ≥ 20.19**
- **[Claude Code](https://docs.claude.com/en/docs/claude-code)** installed and
  logged in to your Pro / Max plan (`claude login`). AI features call Claude
  Code, so they bill against your subscription — there is no `ANTHROPIC_API_KEY`.

## Install

```bash
git clone https://github.com/murnanedaniel/sciencedash
cd sciencedash/web
npm install
cp .env.example .env
npx prisma migrate dev      # one-time DB setup
npm run db:seed             # optional — sample data so the dashboard isn't empty
npm run build && npm run start
```

Open <http://localhost:3000>.

## Required auth

The app refuses to start until four secrets are set in `web/.env`. The
`.env.example` file ships a copy-paste shell snippet that generates all four and
sets your login password in one go:

- `SCIENCEDASH_AUTH_TOKEN` — Bearer token machines (workhorses) use.
- `SCIENCEDASH_SESSION_SECRET` — signs browser session cookies.
- `SCIENCEDASH_PASSWORD_SALT` + `SCIENCEDASH_AUTH_PASSWORD_HASH` — your login.

Run the snippet, paste the four lines into `web/.env`, and restart.

## Optional integrations

Set these in `web/.env` to light up extra features (each is safe to leave blank):

| Variable | Enables |
|---|---|
| `WANDB_API_KEY` | Pulling run metrics from Weights & Biases |
| `GITHUB_PAT` | Tracking repo freshness + quickstart templates |
| `SCIENCEDASH_BASE_URL` | The public origin when running behind a reverse proxy |

## First project

1. Press `n` (or **New project**). Give it a title, tags, and a one-line hypothesis.
2. On the project page, fill the hypothesis / figure-of-merit / timeline / next-steps fields. `idea → active` is gated until they're set.
3. In **Hypotheses & Runs**, declare a primary metric (e.g. `accuracy`, higher is better, threshold `0.95`) and add a hypothesis with a GPU-hour budget.
4. Log runs as you go — name, GPU-h, metric values.
5. When a hypothesis lands, set its verdict to `supported` and click **Spawn paper →** for a six-section skeleton.
6. **AI first pass** fills intro / method / experiments / results from your runs. Polish per section, then **Export .tex**.

Every status change, paper spawn, and accepted AI patch writes to the **Decision
log**, so you can see whether the work is moving forward.

## Going beyond localhost

To reach the dashboard from other devices, or to connect remote **workhorse**
agents on compute hosts, put it behind a reverse proxy (Tailscale, cloudflared,
nginx) and set `SCIENCEDASH_BASE_URL`. See [Remote workhorses](/sciencedash/cluster-integration/).
