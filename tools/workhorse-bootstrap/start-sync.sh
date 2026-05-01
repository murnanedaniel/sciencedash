#!/usr/bin/env bash
# Idempotent "ensure sd-sync tmux session is running" helper.
#
# Called by:
#   1. setup.sh on first install (just delegates here for the actual launch).
#   2. The "Copy start" command on the dashboard's Workhorses panel,
#      prepended ahead of the workhorse claude session — so firing up
#      a workhorse implicitly fires up sync. No more "I started the
#      workhorses but the dashboard shows them unreachable."
#
# Exits 0 if sd-sync is alive (or was just started), nonzero otherwise.
#
# Refuses to start if a sibling sd-sync appears active on a different
# login node (NERSC duplicate-loop pitfall). Override with FORCE=1.

set -euo pipefail

SCIENCEDASH_ROOT="${SCIENCEDASH_ROOT:-$HOME/.sciencedash}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "!! tmux not available; cannot supervise sync.py" >&2
  exit 1
fi

if [[ ! -x "$SCIENCEDASH_ROOT/sync.py" ]]; then
  echo "!! $SCIENCEDASH_ROOT/sync.py missing or not executable — re-run setup.sh" >&2
  exit 1
fi

# Fast path — already alive on this host.
if tmux has-session -t =sd-sync 2>/dev/null; then
  exit 0
fi

# Duplicate-host guard. active-host.txt is updated every tick by sync.py;
# if it's recent and points at a different login node, we'd be the second
# loop on shared NFS $HOME — that breaks liveness reporting.
ACTIVE_HOST_FILE="$SCIENCEDASH_ROOT/active-host.txt"
CURRENT_HOST="$(hostname -s)"
if [[ -f "$ACTIVE_HOST_FILE" ]]; then
  OWNER="$(tr -d '[:space:]' < "$ACTIVE_HOST_FILE" || true)"
  AGE=$(( $(date +%s) - $(stat -c %Y "$ACTIVE_HOST_FILE" 2>/dev/null || echo 0) ))
  if [[ -n "$OWNER" && "$OWNER" != "$CURRENT_HOST" && $AGE -lt 180 ]]; then
    if [[ "${FORCE:-0}" != "1" ]]; then
      echo "!! sd-sync appears active on $OWNER (last beat ${AGE}s ago)." >&2
      echo "!! Refusing to start a duplicate. To take over:" >&2
      echo "!!     ssh $OWNER tmux kill-session -t sd-sync" >&2
      echo "!! Or: FORCE=1 $0" >&2
      exit 1
    fi
  fi
fi

SYNC_CMD_FRAGMENT="SCIENCEDASH_ROOT=$SCIENCEDASH_ROOT $SCIENCEDASH_ROOT/sync.py >> $SCIENCEDASH_ROOT/sync.log 2>&1"
tmux new-session -d -s sd-sync \
  "while true; do
     if ! $SYNC_CMD_FRAGMENT; then
       echo \"[restart] sync.py exited \$? at \$(date -u +%FT%TZ)\" >> $SCIENCEDASH_ROOT/sync.log
       sleep 5
     else
       sleep 55
     fi
   done"

echo "==> sd-sync started on $CURRENT_HOST"
