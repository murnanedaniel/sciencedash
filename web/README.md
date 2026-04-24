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

### Option A: one-click `.cmd` (recommended)

Create `StartScienceDash.cmd` on Windows:

```
wsl -d Ubuntu -e bash -lc "cd /home/<you>/Research/ScienceDash/web && fnm use 20.19.0 >/dev/null 2>&1 || true && npm run start"
start http://localhost:3000
```

Add `npm run build &&` before `npm run start` if you want a fresh build on every launch (slower).

### Option B: Task Scheduler (auto-start at login)

- Trigger: **At log on**
- Action: **Start a program**
  - Program: `wsl.exe`
  - Arguments: `-d Ubuntu -e bash -lc "cd /home/<you>/Research/ScienceDash/web && fnm use 20.19.0 >/dev/null 2>&1 || true && npm run start"`

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
