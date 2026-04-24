# web/

Next.js 16 + Prisma 7 + SQLite app. The user-facing quick start is in [`../README.md`](../README.md); this file covers dev specifics.

## Stack notes

- **Next.js 16** — `params` and `searchParams` are Promises (must `await`). Server actions via `.bind()`. Background jobs boot from `src/instrumentation.ts`. Read `node_modules/next/dist/docs/01-app/` before reaching for any Next API — APIs and conventions have shifted from earlier versions (see `AGENTS.md`).
- **Prisma 7** — generated client at `src/generated/prisma` (gitignored). `mode: "insensitive"` on SQLite is a soft in-app filter, not a DB operator — fine at current row counts but plan around it for any large-table search.
- **better-sqlite3** — synchronous driver via `@prisma/adapter-better-sqlite3`. DB is a single file at `./dev.db`.

## Install

```bash
npm install
npx prisma migrate dev          # one-time DB setup
npx prisma generate             # only needed if schema changed
```

## Run

```bash
npm run dev                     # dev with HMR
npm run build && npm run start  # production build (background worker only boots in this mode)
```

The worker boots once per Node process. In `next dev`, only the first ticked-up server-component request triggers it; production is cleaner.

## Schema changes

```bash
# Edit prisma/schema.prisma, then:
npx prisma migrate dev --name <descriptive_name>
npx prisma generate
```

The Prisma client output path is `src/generated/prisma`. Migrations are applied to `dev.db` immediately.

## Lint and typecheck

```bash
npm run lint
npm run build                   # also runs the TypeScript checker
```

## "No CLI" launcher (Windows + WSL2)

### One-time setup

Copy the launcher script into `~/bin`:

```bash
mkdir -p ~/bin
cp web/scripts/start-sciencedash.sh ~/bin/start-sciencedash.sh
chmod +x ~/bin/start-sciencedash.sh
```

The script activates fnm explicitly. It's needed because `wsl.exe -e bash -lc` spawns a non-interactive login shell, and the standard Ubuntu `~/.bashrc` early-returns in non-interactive mode (line 5–9), so the fnm block further down never runs. Sourcing `.bashrc` doesn't help for the same reason — the script has to set `FNM_PATH` and `eval $(fnm env)` itself.

### Option A: one-click `.cmd` (recommended)

Create `StartScienceDash.cmd` on your Windows desktop:

```cmd
@echo off
REM Launch the server in its own WSL console (so you can see logs / Ctrl-C it later).
start "ScienceDash" wsl.exe -d Ubuntu bash -c "~/bin/start-sciencedash.sh"

REM Poll :3000 up to 60s, then open the browser only once it's actually up.
powershell -NoProfile -Command "for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 -MaximumRedirection 0 -ErrorAction Stop | Out-Null; Start-Process 'http://localhost:3000'; exit } catch { if ($_.Exception.Response.StatusCode.value__ -ge 200) { Start-Process 'http://localhost:3000'; exit } } Start-Sleep -Seconds 1 }"
```

The separate console window lets you see server logs and stop with Ctrl-C. The polling PowerShell opens the browser the moment the server is ready — not before, and not after a fixed delay.

### Option B: Task Scheduler (auto-start at login)

- Trigger: **At log on**
- Action: **Start a program**
  - Program: `wsl.exe`
  - Arguments: `-d Ubuntu bash -c "~/bin/start-sciencedash.sh"`

Pin `http://localhost:3000` as a browser bookmark.

## Backups

`dev.db` is the entire database. Stop the server, then `cp dev.db ~/Backups/sciencedash-$(date +%F).db`. Artifact uploads live under `.data/artifacts/`.

## Project layout

```
src/
  app/
    (dash)/                # route group with persistent sidebar
      page.tsx             # /today
      projects/
      papers/
      runs/
      reading/
      ingredients/
      portfolio/
      settings/
    api/
      ai/                  # /api/ai/{review,skeleton,polish,audit}
      jobs/run/            # manual "pull now" trigger
      ingest/arxiv/        # arxiv autofill
      artifacts/[name]/    # served local files
  components/              # client components (InlineField, CommandPalette, etc.)
  lib/
    server/                # server-action modules
    ai/                    # Claude Agent SDK client + prompt templates
    ingest/                # W&B, GitHub, arXiv
    worker/                # in-process scheduler
    paperTemplate.ts       # default paper section seeds
    ingredientSeed.ts      # default ingredient categories
  generated/prisma/        # gitignored — regen with `npx prisma generate`
  instrumentation.ts       # Next 16 hook that boots the worker
prisma/
  schema.prisma
  migrations/
```
