ScienceDash is a private, local-first research dashboard to track projects (exploit / explore / system), hypotheses, figures of merit, and next steps.

## Getting Started

### Local dev (WSL2)

Prereqs:

- Node >= 20.19 (this repo uses Prisma 7)

Install deps:

- `npm install`

Run migrations (first time only):

- `npx prisma migrate dev`

Start dev server:

- `npm run dev`

Open `http://localhost:3000` in your browser.

### Production-ish local mode

- `npm run build`
- `npm run start`

The SQLite DB is stored at `./dev.db` by default (see `.env`).

## “No CLI” launcher (Windows + WSL2)

The simplest approach is a Windows shortcut or Task Scheduler entry that starts the server inside WSL.

### Option A: one-click `.cmd` (recommended)

Create a file on Windows, for example `StartScienceDash.cmd`, containing:

- `wsl -d Ubuntu -e bash -lc "cd /home/murnanedaniel/Research/ScienceDash/web && fnm use 20.19.0 >/dev/null 2>&1 || true && npm run build && npm run start"`

Then double-click it.

Notes:

- If you prefer faster startup, remove `npm run build` once you have a stable build, and run it only when you update code.
- If you want the browser to open automatically, add a second line: `start http://localhost:3000`

### Option B: Windows Task Scheduler (auto-start on login)

Create a scheduled task:

- Trigger: **At log on**
- Action: **Start a program**
  - Program/script: `wsl.exe`
  - Add arguments: `-d Ubuntu -e bash -lc "cd /home/murnanedaniel/Research/ScienceDash/web && fnm use 20.19.0 >/dev/null 2>&1 || true && npm run start"`

Then pin `http://localhost:3000` as a browser bookmark (or add it to Startup as a URL shortcut).

## Backups

Because the DB is a single SQLite file, backing up is as simple as copying `dev.db` while the app is stopped.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)

