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

# Apply any pending migrations + regen the client every launch. Cheap when
# already up to date; saves the "I added a field and the app won't build"
# dance after pulling.
npx prisma migrate deploy >/dev/null 2>&1 || true
npx prisma generate >/dev/null 2>&1 || true

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
