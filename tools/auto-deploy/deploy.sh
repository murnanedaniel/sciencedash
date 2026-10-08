#!/usr/bin/env bash
#
# ScienceDash auto-deploy — pull-based deploy gated on GitHub CI.
#
# Invoked every ~90s by sciencedash-deploy.timer. On each tick:
#   1. fetch origin/main
#   2. if HEAD == origin/main → bootstrap a missing build, otherwise exit
#      (a failed bootstrap is suppressed for that SHA)
#   3. query GitHub check-runs for the new SHA via `gh api`
#   4. only deploy if every check-run completed with conclusion=success|skipped
#   5. on a deployable SHA: git pull → npm ci (if lockfile changed) →
#      prisma migrate deploy → prisma generate → build inactive slot →
#      atomically publish runtime env → systemctl restart sciencedash
#   Failed builds leave the running server and its slot untouched.
#
# Idempotent and failure-isolated. Logs to ~/.sciencedash/deploy.log.
# Records the last successful deploy SHA + timestamp at
# ~/.sciencedash/last-deploy so the dashboard widget can render it.

set -uo pipefail

# Deployment-specific; override via the systemd unit's Environment= or your
# shell. REPO_SLUG has no default — CI gating is meaningless without it.
REPO_ROOT="${SCIENCEDASH_REPO_ROOT:-$HOME/sciencedash}"
STATE_DIR="${SCIENCEDASH_STATE_DIR:-$HOME/.sciencedash}"
LOG="$STATE_DIR/deploy.log"
LAST_DEPLOY_FILE="$STATE_DIR/last-deploy"
RUNTIME_ENV="$STATE_DIR/sciencedash-runtime.env"
REPO_SLUG="${SCIENCEDASH_REPO_SLUG:?set SCIENCEDASH_REPO_SLUG to your-org/your-repo}"

mkdir -p "$STATE_DIR"

log() {
  echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"
}

# Bring fnm-managed Node + the user's local bins into PATH. systemd user
# units inherit a thin PATH by default, so the gh CLI / claude / node /
# npm can all be missing otherwise.
if [ -d "$HOME/.local/share/fnm/aliases/default/bin" ]; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
fi

cd "$REPO_ROOT" || { log "ERROR: $REPO_ROOT missing"; exit 1; }

# Always be on main when polling. Drift from main means someone is hand-
# editing on the server; we don't auto-deploy in that state.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  log "branch is '$CURRENT_BRANCH' (expected main) — skipping; checkout main to resume auto-deploy"
  exit 0
fi

if ! git fetch origin main --quiet 2>>"$LOG"; then
  log "git fetch failed — skipping this tick"
  exit 0
fi

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)

# Only recognize the two managed slots; never source a state file as shell code.
ACTIVE_SLOT=""
if [ -f "$RUNTIME_ENV" ]; then
  case "$(cat "$RUNTIME_ENV")" in
    SCIENCEDASH_DIST_DIR=.next-a) ACTIVE_SLOT=.next-a ;;
    SCIENCEDASH_DIST_DIR=.next-b) ACTIVE_SLOT=.next-b ;;
  esac
fi

BOOTSTRAP=0
LOCKFILE_CHANGED=0
if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  if [ -n "$ACTIVE_SLOT" ] && [ -f "web/$ACTIVE_SLOT/BUILD_ID" ]; then
    exit 0
  fi
  if [ -f "$STATE_DIR/build-failed-$LOCAL_SHA" ]; then
    exit 0
  fi
  BOOTSTRAP=1
  log "missing production runtime env or BUILD_ID for $LOCAL_SHA — bootstrapping without CI or pull"
fi

if [ "$BOOTSTRAP" = "0" ]; then
  log "new tip on origin/main: $REMOTE_SHA (local: $LOCAL_SHA)"

  # Check CI status for the remote SHA. We use the check-runs API and treat
  # the SHA as deployable only when every run is completed AND every run
  # concluded as success or skipped.
  if ! command -v gh >/dev/null 2>&1; then
    log "ERROR: gh CLI not installed — cannot gate on CI; aborting"
    exit 1
  fi

  CI_STATUS=$(gh api \
    "repos/$REPO_SLUG/commits/$REMOTE_SHA/check-runs?per_page=100" \
    --jq '
      if (.check_runs | length) == 0 then
        "no-runs"
      elif (.check_runs | all(.status == "completed")) then
        if (.check_runs | all(.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral")) then
          "passed"
        else
          "failed"
        end
      else
        "pending"
      end
    ' 2>>"$LOG") || CI_STATUS="error"

  case "$CI_STATUS" in
    passed)
      log "CI passed for $REMOTE_SHA — proceeding"
      ;;
    pending)
      log "CI still running for $REMOTE_SHA — will retry next tick"
      exit 0
      ;;
    failed)
      log "CI failed for $REMOTE_SHA — refusing to deploy (will pick up the next passing commit)"
      exit 0
      ;;
    no-runs)
      log "no CI runs for $REMOTE_SHA — refusing to deploy (push a commit that triggers ci.yml or fix workflow trigger)"
      exit 0
      ;;
    error|*)
      log "couldn't query CI status (gh auth / network?) — skipping; CI_STATUS=$CI_STATUS"
      exit 0
      ;;
  esac

  # Detect package-lock changes between current and target SHA so we know
  # whether to run a full npm ci (slow) or skip it (fast).
  LOCKFILE_CHANGED=0
  if ! git diff --quiet "$LOCAL_SHA" "$REMOTE_SHA" -- web/package-lock.json web/package.json 2>/dev/null; then
    LOCKFILE_CHANGED=1
  fi

  if ! git pull --ff-only --quiet 2>>"$LOG"; then
    log "ERROR: git pull --ff-only failed — local main has diverged from origin"
    exit 1
  fi

fi

cd web || { log "ERROR: web directory missing"; exit 1; }

if [ "$LOCKFILE_CHANGED" = "1" ]; then
  log "package-lock.json changed — npm ci"
  if ! npm ci --silent 2>>"$LOG"; then
    log "ERROR: npm ci failed"
    exit 1
  fi
fi

if ! npx prisma migrate deploy >> "$LOG" 2>&1; then
  log "ERROR: prisma migrate deploy failed"
  exit 1
fi

if ! npx prisma generate >> "$LOG" 2>&1; then
  log "ERROR: prisma generate failed"
  exit 1
fi

BUILD_SLOT=.next-a
if [ "$ACTIVE_SLOT" = ".next-a" ]; then
  BUILD_SLOT=.next-b
fi
log "building $REMOTE_SHA into $BUILD_SLOT"
if ! rm -rf -- "$BUILD_SLOT"; then
  log "ERROR: could not remove stale build slot $BUILD_SLOT"
  exit 1
fi
if ! SCIENCEDASH_DIST_DIR="$BUILD_SLOT" timeout 1200 npx next build >> "$LOG" 2>&1; then
  log "ERROR: next build failed — keeping current server"
  if [ "$BOOTSTRAP" = "1" ]; then
    touch "$STATE_DIR/build-failed-$LOCAL_SHA"
  fi
  exit 1
fi

RUNTIME_TMP=$(mktemp "$RUNTIME_ENV.XXXXXX") || { log "ERROR: cannot create runtime env"; exit 1; }
if ! printf 'SCIENCEDASH_DIST_DIR=%s\n' "$BUILD_SLOT" > "$RUNTIME_TMP" ||
   ! mv -- "$RUNTIME_TMP" "$RUNTIME_ENV"; then
  rm -f -- "$RUNTIME_TMP"
  log "ERROR: cannot publish runtime env — keeping current server"
  exit 1
fi

if ! systemctl --user restart sciencedash 2>>"$LOG"; then
  log "ERROR: systemctl restart sciencedash failed"
  exit 1
fi

# Record success.
echo "$REMOTE_SHA $(date -u +%FT%TZ)" > "$LAST_DEPLOY_FILE"
log "deploy of $REMOTE_SHA complete"
