#!/usr/bin/env bash
# ScienceDash launcher. Called from Windows via wsl.exe. The non-interactive
# bash shell that wsl.exe spawns doesn't load ~/.bashrc (early return on
# non-interactive), so fnm has to be activated explicitly here.
#
# Usage:
#   start-sciencedash.sh           # dev mode with HMR (default)
#   start-sciencedash.sh prod      # production build + start

set -euo pipefail

MODE="${1:-dev}"

# --- Activate fnm (matches the block in ~/.bashrc) -------------------------
export FNM_PATH="$HOME/.local/share/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="$FNM_PATH:$PATH"
  eval "$(fnm env)"
fi

# --- ~/.local/bin on PATH (where `claude` CLI lives) -----------------------
# Same line as ~/.bashrc, but .bashrc is non-interactively short-circuited
# so we replicate it explicitly. Needed so the Claude Agent SDK can find
# the globally-installed `claude` binary at runtime.
export PATH="$HOME/.local/bin:$PATH"

# --- Sanity check ----------------------------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm still not on PATH after fnm activation." >&2
  echo "PATH=$PATH" >&2
  exit 1
fi

# --- Pin the Node version the project needs (>= 20.19 for Prisma 7) --------
fnm use 20.19.0 >/dev/null 2>&1 || fnm use default >/dev/null 2>&1 || true

# --- Run --------------------------------------------------------------------
cd "$HOME/Research/ScienceDash/web"

# Install deps if missing (covers fresh machines and new dep additions).
if [ ! -d "node_modules" ] || [ ! -d "node_modules/next" ]; then
  echo "Installing dependencies…"
  npm install
fi

# Data-safety rail: snapshot dev.db before any migration runs. Keeps a
# rolling trail of recent states in case a pending migration in a branch
# ever turns out to be destructive. Only keep the last 20 backups.
if [ -f "dev.db" ]; then
  cp dev.db "dev.db.bak.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
  ls -1t dev.db.bak.* 2>/dev/null | tail -n +21 | xargs -r rm --
fi

# Apply any pending migrations + regen the client every launch. Cheap when
# already up to date; saves the "I added a field and the app won't build"
# dance after pulling.
npx prisma migrate deploy >/dev/null 2>&1 || true
npx prisma generate >/dev/null 2>&1 || true

# Detect a dev server already on :3000 (e.g. user double-clicked the
# launcher). If so, don't try to start another one — and don't touch
# the tunnel either, since the previous launcher owns it.
DEV_ALREADY_UP=0
if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  DEV_ALREADY_UP=1
  echo "Dev server already running on :3000 — leaving it alone."
fi

# Bring up the Cloudflare tunnel so workhorses can reach dash.science.
# Skip if one is already running. Killed on script exit so the tunnel
# lifecycle matches the dashboard window — but only if we are also
# starting the dev server, otherwise the previous launcher owns it.
if [ "$DEV_ALREADY_UP" = "0" ] \
   && command -v cloudflared >/dev/null 2>&1 \
   && ! pgrep -f "cloudflared tunnel run sciencedash" >/dev/null; then
  echo "Starting Cloudflare tunnel (sciencedash)…"
  nohup cloudflared tunnel run sciencedash >>"$HOME/.cloudflared.log" 2>&1 &
  CLOUDFLARED_PID=$!
  trap 'kill $CLOUDFLARED_PID 2>/dev/null || true' EXIT
fi

if [ "$DEV_ALREADY_UP" = "1" ]; then
  echo "Nothing to do — dashboard is already live at http://localhost:3000."
  exit 0
fi

case "$MODE" in
  prod)
    if [ ! -d ".next" ]; then
      echo "Building for production…"
      npm run build
    fi
    echo "Starting ScienceDash (prod) on http://localhost:3000"
    exec npm run start
    ;;
  dev|*)
    echo "Starting ScienceDash (dev, hot-reloading) on http://localhost:3000"
    echo "Edit any source file and the browser refreshes. Ctrl-C to stop."
    exec npm run dev -- -p 3000
    ;;
esac
