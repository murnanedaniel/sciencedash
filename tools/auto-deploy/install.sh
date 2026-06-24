#!/usr/bin/env bash
#
# One-shot installer for the ScienceDash auto-deploy timer. Run this on
# your dashboard server once. Idempotent — re-running it just refreshes the
# unit files in case they've changed.
#
# Prereqs:
#   - gh CLI installed and authenticated (gh auth login, web flow)
#   - the existing sciencedash.service (the dev server) already running
#   - fnm + Node 22 set up
#   - this repo cloned somewhere; set SCIENCEDASH_REPO_ROOT if it isn't at
#     ~/sciencedash, and SCIENCEDASH_REPO_SLUG to your-org/your-repo
#   - edit sciencedash-deploy.service's ExecStart/Environment to match
#
# Usage:
#   bash <repo>/tools/auto-deploy/install.sh

set -euo pipefail

SRC=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
DEST="$HOME/.config/systemd/user"
REPO_ROOT="${SCIENCEDASH_REPO_ROOT:-$HOME/sciencedash}"

echo "Installing auto-deploy units → $DEST"
mkdir -p "$DEST"
cp "$SRC/sciencedash-deploy.service" "$DEST/sciencedash-deploy.service"
cp "$SRC/sciencedash-deploy.timer" "$DEST/sciencedash-deploy.timer"

systemctl --user daemon-reload
systemctl --user enable --now sciencedash-deploy.timer

echo
echo "Sanity checks:"
if ! command -v gh >/dev/null 2>&1; then
  echo "  ⚠ gh CLI not found in PATH — install it (sudo apt install gh) and run 'gh auth login'"
else
  if gh auth status >/dev/null 2>&1; then
    echo "  ✓ gh CLI authenticated"
  else
    echo "  ⚠ gh CLI not authenticated — run 'gh auth login' (web flow)"
  fi
fi

if [ -f "$REPO_ROOT/web/.env" ]; then
  echo "  ✓ $REPO_ROOT/web/.env present"
else
  echo "  ⚠ $REPO_ROOT/web/.env missing — auth will fail at restart"
fi

echo
echo "Timer state:"
systemctl --user list-timers sciencedash-deploy.timer --no-pager | head -3 || true

echo
echo "Done. First poll runs in ~60s."
echo "Logs: tail -f ~/.sciencedash/deploy.log"
echo "Status: systemctl --user status sciencedash-deploy.timer"
echo "Pause: systemctl --user disable --now sciencedash-deploy.timer"
