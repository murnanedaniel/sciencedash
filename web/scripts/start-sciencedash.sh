#!/usr/bin/env bash
# ScienceDash launcher. Called from Windows via wsl.exe. The non-interactive
# bash shell that wsl.exe spawns doesn't load ~/.bashrc (early return on
# non-interactive), so fnm has to be activated explicitly here.

set -euo pipefail

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

# Build only if no prior build artefacts exist. Remove the .next dir to force
# a rebuild after code changes.
if [ ! -d ".next" ]; then
  echo "First run — building…"
  npm run build
fi

echo "Starting ScienceDash on http://localhost:3000"
exec npm run start
